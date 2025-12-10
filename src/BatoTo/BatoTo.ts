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

/**
 * Full K+N CDN host pool, e.g. k00–k09 and n00–n10.
 * We only ever swap the **first** hostname label (kXX / nXX),
 * leaving the rest of the domain intact (mbwww.org / mbimg.org / mbqgu.org, etc).
 */
const CDN_HOST_POOL: string[] = [
    // k00–k09
    ...Array.from({ length: 10 }, (_, i) => `k${i.toString().padStart(2, '0')}`),
    // n00–n10
    ...Array.from({ length: 11 }, (_, i) => `n${i.toString().padStart(2, '0')}`)
]

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Given an image URL and an attempt index, return the same URL
 * but with the CDN subdomain (kXX / nXX) rotated through CDN_HOST_POOL.
 * If the URL does not look like a Bato image CDN, it is returned untouched.
 */
function getNextCDN(url: string, attempt: number): string {
    try {
        const u = new URL(url)

        // Only touch hosts which look like "<letter><digits>.<rest-of-domain>"
        // and which are Bato image CDNs (contain "mb" in the domain).
        const hostParts = u.hostname.split('.')
        if (hostParts.length < 2) return url

        const [sub, ...rest] = hostParts

        // Subdomain must look like k00 / n10 etc.
        if (!/^[kn]\d{2}$/.test(sub)) return url
        if (!u.hostname.includes('mb')) return url

        const nextHost = CDN_HOST_POOL[attempt % CDN_HOST_POOL.length]
        u.hostname = [nextHost, ...rest].join('.')
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
// SOURCE INFO
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
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.SETTINGS_UI |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    constructor(private cheerio: CheerioAPI) { }

    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 20000,
        interceptor: {
            // Rewrite CDN host per attempt for image requests
            interceptRequest: async (request: Request): Promise<Request> => {
                const attempt = Number((request.headers as any)?.['x-cdn-attempt'] ?? 0)

                // Only touch Bato image CDNs
                if (request.url.includes('mb')) {
                    request.url = getNextCDN(request.url, attempt)
                }

                request.headers = {
                    ...(request.headers ?? {}),
                    'referer': `${BATO_DOMAIN}/`,
                    // Mobile UA seems to behave better with Bato's anti-bot/CDN rules
                    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
                    'x-cdn-attempt': String(attempt)
                }

                return request
            },

            // Retry CDN image failures by rotating through the host pool
            interceptResponse: async (response: Response): Promise<Response> => {
                const status = response.status
                const url = response.request?.url ?? ''
                const attempt = Number((response.request?.headers as any)?.['x-cdn-attempt'] ?? 0)

                let isBatoImage = false
                try {
                    const hostname = new URL(url).hostname
                    isBatoImage = url.includes('mb') && /^[kn]\d{2}\./.test(hostname)
                } catch {
                    isBatoImage = false
                }

                const transientStatus =
                    status === 503 || status === 403 || status === 0 ||
                    status === -1001 || status === -1003

                const shouldRetry = isBatoImage && transientStatus && attempt < CDN_HOST_POOL.length

                if (shouldRetry) {
                    const nextUrl = getNextCDN(url, attempt + 1)

                    return retryWithBackoff(async () => {
                        const retryReq = App.createRequest({
                            url: nextUrl,
                            method: response.request!.method,
                            headers: {
                                ...(response.request!.headers ?? {}),
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
        const request = App.createRequest({
            url: `${BATO_DOMAIN}/series/${mangaId}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${BATO_DOMAIN}/series/${mangaId}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        const chapters = parseChapterList($, mangaId)

        // Soft-fail instead of crashing if Bato returns an empty list
        if (!chapters.length) return []
        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${BATO_DOMAIN}/chapter/${chapterId}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = App.createRequest({
            url: `${BATO_DOMAIN}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        parseHomeSections($, sectionCallback)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: Metadata | undefined): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let param = ''

        switch (homepageSectionId) {
            case 'popular_updates':
                param = `?sort=views_d.za&page=${page}`
                break
            case 'latest_releases':
                param = `?sort=update.za&page=${page}`
                break
            default:
                throw new Error('Requested to getViewMoreItems for a section ID which doesn\'t exist')
        }

        const langHomeFilter: boolean = await this.stateManager.retrieve('language_home_filter') ?? false
        const langs: string[] = await this.stateManager.retrieve('languages') ?? BTLanguages.getDefault()
        param += langHomeFilter ? `&langs=${langs.join(',')}` : ''

        const request = App.createRequest({
            url: `${BATO_DOMAIN}/browse`,
            method: 'GET',
            param
        })
        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)
        const manga = parseViewMore($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: Metadata | undefined): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let request: Request

        if (query.title) {
            // Text search
            request = App.createRequest({
                url: `${BATO_DOMAIN}/search?word=${encodeURI(query.title ?? '')}&page=${page}`,
                method: 'GET'
            })
        } else {
            // Tag search – use first included tag
            const tagId = query?.includedTags?.[0]?.id
            request = App.createRequest({
                url: `${BATO_DOMAIN}/browse?genres=${tagId ?? ''}&page=${page}`,
                method: 'GET'
            })
        }

        const langSearchFilter: boolean = await this.stateManager.retrieve('language_search_filter') ?? false
        const langs: string[] = await this.stateManager.retrieve('languages') ?? BTLanguages.getDefault()

        const response = await this.requestManager.schedule(request, 1)
        const $ = this.cheerio.load(response.data as string)
        const manga = parseSearch($, langSearchFilter, langs)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        return parseTags()
    }

    CloudFlareError(status: number): void {
        if (status === 503 || status === 403) {
            throw new Error(
                `CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <${BatoTo.name}> and press the cloud icon.`
            )
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
