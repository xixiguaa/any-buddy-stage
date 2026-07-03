import type { AppService } from './app-service.js'
import type { AgentToolCall, ToolDefinition, ToolExecutionContext } from './agent-runtime-types.js'

function normalizeSearchQuery(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed || fallback
}

function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeMaxResults(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5
  }

  return Math.min(Math.max(Math.floor(value), 1), 10)
}

type DuckDuckGoTopic = {
  Text?: string
  FirstURL?: string
  Topics?: DuckDuckGoTopic[]
}

type DuckDuckGoResponse = {
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] | undefined): Array<{ title: string; url: string; snippet: string }> {
  if (!topics?.length) {
    return []
  }

  const results: Array<{ title: string; url: string; snippet: string }> = []
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
      })
    }
  }

  return results
}

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

export class ToolRegistryService {
  private readonly tools = new Map<ToolDefinition['name'], ToolDefinition>()

  constructor(private readonly appService: AppService) {
    this.registerBuiltins()
  }

  getTool(name: AgentToolCall['name']) {
    return this.tools.get(name) ?? null
  }

  listTools() {
    return [...this.tools.values()]
  }

  private registerBuiltins() {
    this.register({
      name: 'web_search',
      description: '基于 DuckDuckGo Instant Answer 抓取公开网页摘要与相关主题，返回结构化搜索结果。',
      requiresApproval: false,
      execute: async (context: ToolExecutionContext, args) => {
        if (!context.settings.networkEnabled || !context.settings.webSearchEnabled) {
          return {
            summary: '当前设置中网络搜索未启用，请在设置中开启网络访问和 Web 搜索。',
            data: {
              enabled: false,
              reason: 'network_disabled',
            },
          }
        }

        const query = normalizeSearchQuery(args.query, context.task.title)
        const domains = normalizeDomains(args.domains)
        const maxResults = normalizeMaxResults(args.maxResults)
        const response = await fetch(`https://api.duckduckgo.com/?${new URLSearchParams({
          q: query,
          format: 'json',
          no_html: '1',
          skip_disambig: '1',
        }).toString()}`)
        if (!response.ok) {
          throw new Error(`web_search request failed: ${response.status}`)
        }

        const payload = (await response.json()) as DuckDuckGoResponse
        const rawResults = [
          ...(payload.AbstractText && payload.AbstractURL
            ? [{
                title: payload.AbstractText,
                url: payload.AbstractURL,
                snippet: payload.AbstractText,
              }]
            : []),
          ...flattenDuckDuckGoTopics(payload.RelatedTopics),
        ]
        const dedupedResults = rawResults.filter((item, index, list) =>
          list.findIndex(candidate => candidate.url === item.url) === index,
        )
        const filteredResults = dedupedResults.filter(item => matchesDomainFilter(item.url, domains))
        const results = filteredResults.slice(0, maxResults).map(item => ({
          ...item,
          sourceTime: null,
        }))

        return {
          summary: `已为查询 "${query}" 抓取 ${results.length} 条结果。`,
          data: {
            enabled: true,
            provider: 'duckduckgo_instant_answer',
            query,
            domains,
            maxResults,
            results,
            audit: {
              rawCount: rawResults.length,
              filteredCount: dedupedResults.length - filteredResults.length,
            },
          },
        }
      },
    })
  }

  private register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }
}