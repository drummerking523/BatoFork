// ✅ CLEAN STABLE BATO SOURCE WITH SAFE CDN RETRY

import {
    BadgeColor, Chapter, ChapterDetails, ChapterProviding, ContentRating,
    DUISection, HomePageSectionsProviding, HomeSection, MangaProviding,
    PagedResults, Request, Response, SearchRequest, SearchResultsProviding,
    SourceInfo, SourceIntents, SourceManga, Tag, TagSection
} from '@paperback/types'

import {
    isLastPage, parseChapterDetails, parseChapterList,
    parseHomeSections, parseMangaDetails,
    parseSearch, parseTags, parseViewMore
} from './BatoToParser'

import { BTLanguages, Metadata } from './BatoToHelper'
import { languageSettings, resetSettings } from './BatoToSettings'

const BATO_DOMAIN = 'https://bato.to'

const CDN_POOL = [
    "k00","k01","k02","k03","k04","k05","k06","k07","k08","k09",
    "n00","n01","n02","n03","n04","n05","n06","n07","n08","n09","n10"
]

function rotateCDN(url: string, attempt: number): string {
    try {
        const u = new URL(url)
        const parts = u.hostname.split('.')
        if (!/^[kn]\d{2}$/.test(parts[0]) || !u.hostname.includes('mb')) return url
        parts[0] = CDN_POOL[attempt % CDN_POOL.length]
        u.hostname = parts.join('.')
        return u.toString()
    } catch {
        return url
    }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, delay = 400): Promise<T> {
    try { return await fn() }
    catch {
        if (!retries) throw new Error("CDN Exhausted")
        await sleep(delay)
        return retryWithBackoff(fn, retries - 1, delay * 2)
    }
}

// ✅ SOURCE INFO
export const BatoToInfo: SourceInfo = {
    version: '3.2.0',
    name: 'BatoTo',
    icon: 'icon.png',
    author: 'drummerking523',
    description: 'Stable BatoTo with automatic CDN failover',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATO_DOMAIN,
    sourceTags: [{ text: 'Multi Language', type: BadgeColor.BLUE }],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS |
             SourceIntents.SETTINGS_UI | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo implements
    SearchResultsProviding, MangaProviding,
    ChapterProviding, HomePageSectionsProviding {

    constructor(private cheerio: CheerioAPI) {}

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const attempt = Number((request.headers as any)?.['x-cdn-attempt'] ?? 0)
                if (request.url.includes('mb')) request.url = rotateCDN(request.url, attempt)

                request.headers = {
                    ...(request.headers ?? {}),
                    'referer': `${BATO_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent(),
                    'x-cdn-attempt': String(attempt)
                }
                return request
            },

            interceptResponse: async (response: Response): Promise<Response> => {
                const url = response.request?.url ?? ''
                const attempt = Number((response.request?.headers as any)?.['x-cdn-attempt'] ?? 0)

                if ([403,503,0].includes(response.status) && url.includes('mb') && attempt < 10) {
                    const retryUrl = rotateCDN(url, attempt + 1)
                    return retryWithBackoff(async () => {
                        const req = App.createRequest({
                            url: retryUrl,
                            method: response.request!.method,
                            headers: {
                                ...(response.request!.headers ?? {}),
                                'x-cdn-attempt': String(attempt + 1)
                            }
                        })
                        return this.requestManager.schedule(req, 1)
                    })
                }
                return response
            }
        }
    })

    stateManager = App.createSourceStateManager()

    async getSourceMenu(): Promise<DUISection> {
        return App.createDUISection({
            id: 'main',
            header: 'Source Settings',
            rows: async () => [languageSettings(this.stateManager), resetSettings(this.stateManager)]
        })
    }

    getMangaShareUrl(id: string) { return `${BATO_DOMAIN}/series/${id}` }

    async getMangaDetails(id: string): Promise<SourceManga> {
        const r = await this.requestManager.schedule(App.createRequest({
            url: `${BATO_DOMAIN}/series/${id}`, method: 'GET'
        }), 1)
        return parseMangaDetails(this.cheerio.load(r.data as string), id)
    }

    async getChapters(id: string): Promise<Chapter[]> {
        const r = await this.requestManager.schedule(App.createRequest({
            url: `${BATO_DOMAIN}/series/${id}`, method: 'GET'
        }), 1)
        return parseChapterList(this.cheerio.load(r.data as string), id)
    }

    async getChapterDetails(mid: string, cid: string): Promise<ChapterDetails> {
        const r = await this.requestManager.schedule(App.createRequest({
            url: `${BATO_DOMAIN}/chapter/${cid}`, method: 'GET'
        }), 1)
        return parseChapterDetails(this.cheerio.load(r.data as string), mid, cid)
    }

    async getHomePageSections(cb: (s: HomeSection) => void): Promise<void> {
        const r = await this.requestManager.schedule(App.createRequest({ url: BATO_DOMAIN, method: 'GET' }), 1)
        parseHomeSections(this.cheerio.load(r.data as string), cb)
    }

    async getViewMoreItems(id: string, meta?: Metadata): Promise<PagedResults> {
        const page = meta?.page ?? 1
        const r = await this.requestManager.schedule(App.createRequest({
            url: `${BATO_DOMAIN}/browse?...`, method: 'GET'
        }), 1)
        const $ = this.cheerio.load(r.data as string)
        return App.createPagedResults({ results: parseViewMore($), metadata: !isLastPage($)?{page:page+1}:undefined })
    }

    async getSearchResults(q: SearchRequest, meta?: Metadata): Promise<PagedResults> {
        const r = await this.requestManager.schedule(App.createRequest({
            url: `${BATO_DOMAIN}/search?word=${encodeURI(q.title ?? '')}`, method: 'GET'
        }), 1)
        const $ = this.cheerio.load(r.data as string)
        return App.createPagedResults({ results: parseSearch($), metadata: undefined })
    }

    async getSearchTags(): Promise<TagSection[]> { return parseTags() }
}
