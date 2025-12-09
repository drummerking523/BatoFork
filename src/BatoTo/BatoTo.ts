import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    isLastPage,
    parseChapterDetails,
    parseChapterList,
    parseHomeSections,
    parseMangaDetails,
    parseSearch,
    parseTags,
    parseViewMore
} from './BatoToParser'

import { BTLanguages, Metadata } from './BatoToHelper'
import { languageSettings, resetSettings } from './BatoToSettings'

const BATO_DOMAIN = 'https://bato.to'

// =========================
// ✅ FULL CDN HOST POOL
// =========================
const CDN_HOST_POOL = [
    ...Array.from({ length: 10 }, (_, i) => `k${i.toString().padStart(2, '0')}`),  // k00–k09
    ...Array.from({ length: 11 }, (_, i) => `n${i.toString().padStart(2, '0')}`)   // n00–n10
]

// --- Helpers ---
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function getNextCDN(url: string, attempt: number): string {
    try {
        const u = new URL(url)
        if (!u.hostname.includes('mbwww.org')) return url

        const next = CDN_HOST_POOL[attempt % CDN_HOST_POOL.length]
        u.hostname = `${next}.mbwww.org`
        return u.toString()
    } catch {
        return url
    }
}

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = 4,
    delay = 400
): Promise<T> {
    try {
        return await fn()
    } catch (err) {
        if (retries <= 0) throw err
        await sleep(delay)
        return retryWithBackoff(fn, retries - 1, delay * 2)
    }
}

// =========================
// ✅ SOURCE INFO
// =========================
export const BatoToInfo: SourceInfo = {
    version: '3.1.6',
    name: 'BatoTo',
    icon: 'icon.png',
    author: 'Drummerking523',
    authorWebsite: 'https://github.com/drummerking523/BatoFix',
    description: 'Extension that pulls manga from bato.to',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATO_DOMAIN,
    sourceTags: [{ text: 'Multi Language', type: BadgeColor.BLUE }],
    intents: SourceIntents.MANGA_CHAPTERS
           | SourceIntents.HOMEPAGE_SECTIONS
           | SourceIntents.SETTINGS_UI
           | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    constructor(private cheerio: CheerioAPI) { }

    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 20000,
        interceptor: {

            // ✅ Rewrite CDN host per attempt
            interceptRequest: async (request: Request): Promise<Request> => {
                const attempt = Number(request.headers?.['x-cdn-attempt'] ?? 0)

                if (request.url.includes('mbwww.org')) {
                    request.url = getNextCDN(request.url, attempt)
                }

                request.headers = {
                    ...(request.headers ?? {}),
                    'referer': `${BATO_DOMAIN}/`,
                    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
                    'x-cdn-attempt': String(attempt)
                }

                return request
            },

            // ✅ Retry on ANY failure type
            interceptResponse: async (response: Response): Promise<Response> => {
                const status = response.status
                const url = response.request?.url ?? ''
                const attempt = Number(response.request?.headers?.['x-cdn-attempt'] ?? 0)

                const shouldRetry =
                    url.includes('mbwww.org') &&
                    (status === 503 || status === 403 || status === 0 || status === -1001 || status === -1003)

                if (shouldRetry && attempt < CDN_HOST_POOL.length) {
                    const nextUrl = getNextCDN(url, attempt + 1)

                    return retryWithBackoff(async () => {
                        const retryReq = App.createRequest({
                            url: nextUrl,
                            method: response.request!.method,
                            headers: {
                                ...response.request!.headers,
                                'x-cdn-attempt': String(attempt + 1)
                            }
                        })
                        return this.requestManager.schedule(retryReq, 1)
                    })
                }

                return response
            }
        }
    })

    stateManager = App.createSourceStateManager()

    async getSourceMenu(): Promise<DUISection> {
        return Promise.resolve(App.createDUISection({
            id: 'main',
            header: 'Source Settings',
            isHidden: false,
            rows: async () => [
                languageSettings(this.stateManager),
                resetSettings(this.stateManager)
            ]
        }))
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BATO_DOMAIN}/series/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${BATO_DOMAIN}/series/${mangaId}`, method: 'GET' }), 1
        )
        this.CloudFlareError(res.status)
        return parseMangaDetails(this.cheerio.load(res.data as string), mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${BATO_DOMAIN}/series/${mangaId}`, method: 'GET' }), 1
        )
        this.CloudFlareError(res.status)
        const chapters = parseChapterList(this.cheerio.load(res.data as string), mangaId)

        // ✅ Soft-fail instead of crash
        if (!chapters.length) return []

        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${BATO_DOMAIN}/chapter/${chapterId}`, method: 'GET' }), 1
        )
        this.CloudFlareError(res.status)
        return parseChapterDetails(this.cheerio.load(res.data as string), mangaId, chapterId)
    }

    async getHomePageSections(cb: (section: HomeSection) => void): Promise<void> {
        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${BATO_DOMAIN}`, method: 'GET' }), 1
        )
        this.CloudFlareError(res.status)
        parseHomeSections(this.cheerio.load(res.data as string), cb)
    }

    async getViewMoreItems(id: string, metadata: Metadata | undefined): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        let param = id === 'popular_updates'
            ? `?sort=views_d.za&page=${page}`
            : `?sort=update.za&page=${page}`

        const langHomeFilter = await this.stateManager.retrieve('language_home_filter') ?? false
        const langs = await this.stateManager.retrieve('languages') ?? BTLanguages.getDefault()
        param += langHomeFilter ? `&langs=${langs.join(',')}` : ''

        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${BATO_DOMAIN}/browse`, method: 'GET', param }), 1
        )

        const $ = this.cheerio.load(res.data as string)
        metadata = !isLastPage($) ? { page: page + 1 } : undefined

        return App.createPagedResults({ results: parseViewMore($), metadata })
    }

    async getSearchResults(query: SearchRequest, metadata: Metadata | undefined): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const req = query.title
            ? App.createRequest({ url: `${BATO_DOMAIN}/search?word=${encodeURI(query.title)}&page=${page}`, method: 'GET' })
            : App.createRequest({ url: `${BATO_DOMAIN}/browse?genres=${query?.includedTags?.[0]?.id}&page=${page}`, method: 'GET' })

        const langSearchFilter = await this.stateManager.retrieve('language_search_filter') ?? false
        const langs = await this.stateManager.retrieve('languages') ?? BTLanguages.getDefault()

        const res = await this.requestManager.schedule(req, 1)
        const $ = this.cheerio.load(res.data as string)
        metadata = !isLastPage($) ? { page: page + 1 } : undefined

        return App.createPagedResults({
            results: parseSearch($, langSearchFilter, langs),
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        return parseTags()
    }

    CloudFlareError(status: number): void {
        if (status === 503 || status === 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <${BatoTo.name}> and press the cloud icon.`)
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: BATO_DOMAIN,
            method: 'GET',
            headers: {
                'referer': `${BATO_DOMAIN}/`,
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
            }
        })
    }
}
