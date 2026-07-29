import type { AppService } from './app-service.js'
import type { AgentToolCall, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './agent-runtime-types.js'
import { z } from 'zod'

// 网络搜索请求超时时间 (5 秒)
const SEARCH_TIMEOUT_MS = 5000

// 默认使用的开源 SearXNG 公共实例节点列表（自动轮询尝试）
const DEFAULT_SEARXNG_INSTANCES = [
  'https://etsi.me',
  'https://failsearx.culturanerd.it',
  'https://baresearch.org',
] as const

// 网络搜索 HTTP 请求头声明
const SEARCH_REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CulClaw/0.1',
}

/** 规范化后的单个搜索结果项 */
type SearchResultItem = {
  title: string
  url: string
  snippet: string
  sourceTime: string | null
}

/** DuckDuckGo Topic 递归响应类型 */
type DuckDuckGoTopic = {
  Text?: string
  FirstURL?: string
  Topics?: DuckDuckGoTopic[]
}

/** DuckDuckGo API 返回载荷 */
type DuckDuckGoResponse = {
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

/** SearXNG 单条结果响应类型 */
type SearxngResult = {
  title?: string
  url?: string
  content?: string
  publishedDate?: string | null
}

/** SearXNG API 返回载荷 */
type SearxngResponse = {
  results?: SearxngResult[]
}

/** 规范化搜索查询关键词：若参数为空则退回使用任务标题作为关键词 */
function normalizeSearchQuery(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed || fallback
}

/** 规范化域名过滤列表：清洗并转换为小写字符串数组 */
function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

/** 规范化最大结果数量：限制在 1 到 10 条之间（默认 5 条） */
function normalizeMaxResults(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5
  }

  return Math.min(Math.max(Math.floor(value), 1), 10)
}

/** 递归展平 DuckDuckGo 返回的嵌套相关主题树 */
function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] | undefined): SearchResultItem[] {
  if (!topics?.length) {
    return []
  }

  const results: SearchResultItem[] = []
  for (const topic of topics) {
    if (Array.isArray(topic.Topics)) {
      results.push(...flattenDuckDuckGoTopics(topic.Topics))
      continue
    }

    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
        sourceTime: null,
      })
    }
  }

  return results
}

/** 判断目标 URL 是否符合允许的域名白名单条件 */
function matchesDomainFilter(url: string, domains: string[]) {
  if (domains.length === 0) {
    return true
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/** 安全格式化 Error 异常消息 */
function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 结算与整理搜索结果：
 * 1. 根据 URL 唯一性进行去重
 * 2. 根据域名白名单过滤
 * 3. 截取最大指定数量，并返回审计日志统计
 */
function finalizeResults(rawResults: SearchResultItem[], domains: string[], maxResults: number) {
  const dedupedResults = rawResults.filter((item, index, list) =>
    list.findIndex(candidate => candidate.url === item.url) === index,
  )
  const filteredResults = dedupedResults.filter(item => matchesDomainFilter(item.url, domains))

  return {
    results: filteredResults.slice(0, maxResults),
    audit: {
      rawCount: rawResults.length,
      dedupedCount: dedupedResults.length,
      filteredCount: dedupedResults.length - filteredResults.length,
    },
  }
}

/** 构造 SearXNG API 的完整请求 URL */
function buildSearxngUrl(baseUrl: string, query: string) {
  const url = new URL(baseUrl)
  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = '/search'
  }
  url.search = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'all',
    safesearch: '0',
  }).toString()
  return url.toString()
}

/** 带 5 秒自动超时中断机制的通用 JSON fetch 请求封装 */
async function fetchJson(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: SEARCH_REQUEST_HEADERS,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`)
    }
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 优先请求 SearXNG 公共节点获取搜索结果。
 * 轮询 DEFAULT_SEARXNG_INSTANCES 列表，只要有一台节点成功响应且有结果即立刻返回。
 */
async function searchViaSearxng(query: string, domains: string[], maxResults: number): Promise<ToolExecutionResult | null> {
  const providerErrors: Array<{ instanceUrl: string; reason: string }> = []

  for (const instanceUrl of DEFAULT_SEARXNG_INSTANCES) {
    try {
      const payload = await fetchJson(buildSearxngUrl(instanceUrl, query)) as SearxngResponse
      const rawResults = (payload.results ?? [])
        .filter(item => typeof item.url === 'string' && typeof item.title === 'string')
        .map(item => ({
          title: item.title!.trim(),
          url: item.url!,
          snippet: typeof item.content === 'string' && item.content.trim()
            ? item.content.trim()
            : item.title!.trim(),
          sourceTime: typeof item.publishedDate === 'string' && item.publishedDate.trim()
            ? item.publishedDate
            : null,
        }))
        .filter(item => item.title && item.url)

      const { results, audit } = finalizeResults(rawResults, domains, maxResults)
      return {
        summary: `Fetched ${results.length} web results for "${query}" via SearXNG.`,
        data: {
          enabled: true,
          provider: 'searxng',
          instanceUrl,
          query,
          domains,
          maxResults,
          results,
          audit,
        },
      }
    } catch (error) {
      providerErrors.push({
        instanceUrl,
        reason: toErrorMessage(error),
      })
    }
  }

  if (providerErrors.length === 0) {
    return null
  }

  return {
    summary: `SearXNG search failed for "${query}". Falling back to DuckDuckGo.`,
    data: {
      enabled: true,
      provider: 'searxng',
      query,
      domains,
      maxResults,
      results: [],
      audit: {
        rawCount: 0,
        dedupedCount: 0,
        filteredCount: 0,
        providerErrors,
      },
    },
  }
}

/**
 * 当 SearXNG 失败时的备用方案：请求 DuckDuckGo Instant Answer API 获取搜索结果。
 */
async function searchViaDuckDuckGo(
  query: string,
  domains: string[],
  maxResults: number,
  searxngAudit?: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const payload = await fetchJson(`https://api.duckduckgo.com/?${new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  }).toString()}`) as DuckDuckGoResponse

  const rawResults = [
    ...(payload.AbstractText && payload.AbstractURL
      ? [{
          title: payload.AbstractText,
          url: payload.AbstractURL,
          snippet: payload.AbstractText,
          sourceTime: null,
        }]
      : []),
    ...flattenDuckDuckGoTopics(payload.RelatedTopics),
  ]

  const { results, audit } = finalizeResults(rawResults, domains, maxResults)
  return {
    summary: `Fetched ${results.length} web results for "${query}" via DuckDuckGo fallback.`,
    data: {
      enabled: true,
      provider: 'duckduckgo_instant_answer',
      fallbackFrom: 'searxng',
      query,
      domains,
      maxResults,
      results,
      audit: {
        ...audit,
        searxng: searxngAudit ?? null,
      },
    },
  }
}

/**
 * 项目扩展工具注册与管理服务 (ToolRegistryService)
 * 
 * 核心职责：
 * 1. 注册并维护除 DeepAgents 内置工具（文件系统/Shell）之外的项目拓展工具白名单。
 * 2. 提供 `web_search` 联网搜索工具的完整实现（包含 SearXNG 多节点轮询、DuckDuckGo 降级兜底、网络与开关设置校验、域名过滤与结果去重）。
 */
export class ToolRegistryService {
  private readonly tools = new Map<ToolDefinition['name'], ToolDefinition>()

  constructor(private readonly appService: AppService) {
    this.registerBuiltins()
  }

  /** 获取指定名称的已注册工具 */
  getTool(name: AgentToolCall['name']) {
    return this.tools.get(name) ?? null
  }

  /** 获取当前所有已注册的拓展工具列表 */
  listTools() {
    return [...this.tools.values()]
  }

  /**
   * 注册内置的项目扩展工具（目前包含 `web_search` 网络搜索）
   */
  private registerBuiltins() {
    this.register({
      name: 'web_search',
      connectorId: 'web-search',
      description: 'Searches the public web via SearXNG and falls back to DuckDuckGo Instant Answer when needed.',
      inputSchema: z.object({
        query: z.string().trim().min(1).optional().describe('Search query. Omit to fall back to the current task title.'),
        domains: z.array(z.string().trim().min(1)).max(10).optional().describe('Optional domain allowlist, for example ["openai.com", "platform.openai.com"].'),
        maxResults: z.number().int().min(1).max(10).optional().describe('Maximum number of results to return, between 1 and 10.'),
      }).passthrough(),
      requiresApproval: false,
      execute: async (context: ToolExecutionContext, args) => {
        // 校验全局设置：如未开启网络或未启用 webSearch，直接返回不可用提示
        if (!context.settings.networkEnabled || !context.settings.webSearchEnabled) {
          return {
            summary: 'Web search is disabled. Enable network access and web search in settings.',
            data: {
              enabled: false,
              reason: 'network_disabled',
            },
          }
        }

        const query = normalizeSearchQuery(args.query, context.task.title)
        const domains = normalizeDomains(args.domains)
        const maxResults = normalizeMaxResults(args.maxResults)

        // 1. 优先尝试 SearXNG
        const searxngResult = await searchViaSearxng(query, domains, maxResults)
        if (searxngResult?.data.provider === 'searxng' && Array.isArray(searxngResult.data.results) && searxngResult.data.results.length > 0) {
          return searxngResult
        }

        // 2. 若 SearXNG 节点未返回结果或全盘超时失败，优雅降级到 DuckDuckGo
        const searxngAudit = searxngResult?.data.audit as Record<string, unknown> | undefined
        return searchViaDuckDuckGo(query, domains, maxResults, searxngAudit)
      },
    })
  }

  /** 内部工具注册入口 */
  private register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }
}
