import type { AppService } from './app-service.js'
import type { AgentToolCall, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './agent-runtime-types.js'
import { z } from 'zod'

const SEARCH_TIMEOUT_MS = 5000
const DEFAULT_SEARXNG_INSTANCES = [
  'https://etsi.me',
  'https://failsearx.culturanerd.it',
  'https://baresearch.org',
] as const
const SEARCH_REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AnyBuddy/0.1',
}

type SearchResultItem = {
  title: string
  url: string
  snippet: string
  sourceTime: string | null
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

type SearxngResult = {
  title?: string
  url?: string
  content?: string
  publishedDate?: string | null
}

type SearxngResponse = {
  results?: SearxngResult[]
}

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

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

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
      connectorId: 'web-search',
      description: 'Searches the public web via SearXNG and falls back to DuckDuckGo Instant Answer when needed.',
      inputSchema: z.object({
        query: z.string().trim().min(1).optional().describe('Search query. Omit to fall back to the current task title.'),
        domains: z.array(z.string().trim().min(1)).max(10).optional().describe('Optional domain allowlist, for example ["openai.com", "platform.openai.com"].'),
        maxResults: z.number().int().min(1).max(10).optional().describe('Maximum number of results to return, between 1 and 10.'),
      }).passthrough(),
      requiresApproval: false,
      execute: async (context: ToolExecutionContext, args) => {
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

        const searxngResult = await searchViaSearxng(query, domains, maxResults)
        if (searxngResult?.data.provider === 'searxng' && Array.isArray(searxngResult.data.results) && searxngResult.data.results.length > 0) {
          return searxngResult
        }

        const searxngAudit = searxngResult?.data.audit as Record<string, unknown> | undefined
        return searchViaDuckDuckGo(query, domains, maxResults, searxngAudit)
      },
    })
  }

  private register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }
}
