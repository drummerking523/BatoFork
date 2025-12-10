import {
    Chapter,
    ChapterDetails,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    SearchResultsProviding,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    BTGenres,
    BTLanguages
} from './BatoToHelper'

import * as CryptoJS from './external/crypto-js.min'
import { CheerioAPI } from 'cheerio'
import entities = require('entities')

// =========================
// ✅ SAFE HELPERS
// =========================

function cleanText(input?: string): string {
    return input?.replace(/\s+/g, ' ').trim() || ''
}

function normalizeUrl(url?: string): string {
    if (!url) return ''
    if (url.startsWith('//')) return `https:${url}`
    if (url.startsWith('/')) return `https://bato.to${url}`
    return url
}

// =========================
// ✅ MANGA DETAILS (FIXES mangaInfo CRASH)
// =========================

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {

    const title =
        cleanText($('h1').first().text()) ||
        cleanText($('meta[property="og:title"]').attr('content')) ||
        'Unknown Title'

    const image =
        normalizeUrl($('meta[property="og:image"]').attr('content')) ||
        normalizeUrl($('img').first().attr('src')) ||
        ''

    const description =
        cleanText($('meta[property="og:description"]').attr('content')) ||
        cleanText($('.description, .summary').text()) ||
        'No description available.'

    return App.createSourceManga({
        id: mangaId,
        title: title,
        image: image,
        desc: description,
        status: 'Unknown'
    })
}

// =========================
// ✅ THUMBNAIL
// =========================

export function parseThumbnailUrl($: CheerioAPI): string {
    const img =
        $('meta[property="og:image"]').attr('content') ||
        $('img').first().attr('src')

    return normalizeUrl(img)
}

// =========================
// ✅ CHAPTER LIST
// =========================

export function parseChapterList($: CheerioAPI, mangaId: string): Chapter[] {

    const chapters: Chapter[] = []

    $('.episode-list a').each((_, el) => {
        const url = $(el).attr('href')
        const id = url?.split('/').pop()

        const name = cleanText($(el).find('.episode-title').text()) || 'Chapter'

        if (!id) return

        chapters.push(
            App.createChapter({
                id,
                mangaId,
                name,
                langCode: 'en'
            })
        )
    })

    return chapters
}

// =========================
// ✅ CHAPTER PAGES (DECRYPT SAFELY)
// =========================

export function parseChapterDetails(
    $: CheerioAPI,
    mangaId: string,
    chapterId: string
): ChapterDetails {

    const script = $('script')
        .toArray()
        .map(el => $(el).html())
        .join('\n')

    const batoPass =
        eval(script.match(/const\s+batoPass\s*=\s*(.*?);/)?.[1] ?? '').toString()

    const encrypted =
        script.match(/const\s+imgHttps\s*=\s*(.*?);/)?.[1] ?? '[]'

    const imgList = CryptoJS.AES.decrypt(
        encrypted,
        batoPass
    ).toString(CryptoJS.enc.Utf8)

    const pages: string[] = []

    try {
        const parsed = JSON.parse(imgList)
        for (const img of parsed) {
            pages.push(normalizeUrl(img))
        }
    } catch {
        // fail soft
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages: pages
    })
}

// =========================
// ✅ HOME SECTIONS
// =========================

export const parseHomeSections = ($: CheerioAPI, sectionCallback: (section: HomeSection) => void): void => {

    // --- Helper to normalize a tile into a full SourceManga ---
    const createTileManga = (elem: Cheerio<Element>): SourceManga | null => {
        const mangaId = $('a', elem).attr('href')?.split('/series/')[1]?.split(/[/?#]/)[0]
        if (!mangaId) return null

        const title = $('.item-title', elem).text().trim() ||
            $('img', elem).attr('alt')?.trim() ||
            'Unknown Title'

        // Bato uses a special thumbnail system; we keep the same pattern you already use
        const image = `mangaId=${mangaId}`

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title],
                image: image,
                status: 'Ongoing',   // we don’t know actual status from the tile
                author: '',
                artist: '',
                tags: [],
                desc: ''
            })
        })
    }

    // --- Build sections (Popular Updates + Latest Releases) ---

    const popularSection = App.createHomeSection({
        id: 'popular_updates',
        title: 'Popular Updates',
        type: HomeSectionType.singleRowLarge,
        containsMoreItems: true
    })

    const latestSection = App.createHomeSection({
        id: 'latest_releases',
        title: 'Latest Releases',
        type: HomeSectionType.singleRowNormal,
        containsMoreItems: true
    })

    const popularItems: SourceManga[] = []
    const latestItems: SourceManga[] = []

    // Popular updates block – same selectors as before
    $('.hot-updates .col.item, .highlight-updates .col.item').each((_, elem) => {
        const manga = createTileManga($(elem))
        if (manga) popularItems.push(manga)
    })

    // Latest releases block – same selectors as before
    $('.latest-updates .col.item, .latest-updates .item').each((_, elem) => {
        const manga = createTileManga($(elem))
        if (manga) latestItems.push(manga)
    })

    popularSection.items = popularItems
    latestSection.items = latestItems

    // Only call back once per section *after* items are fully formed
    sectionCallback(popularSection)
    sectionCallback(latestSection)
}

// =========================
// ✅ VIEW MORE
// =========================

export const parseViewMore = ($: CheerioAPI): SourceManga[] => {
    const mangas: SourceManga[] = []

    $('.series-list .col.item, .series-list .item').each((_, manga) => {
        const id = $('a', manga).attr('href')?.split('/series/')[1]?.split(/[/?#]/)[0]
        if (!id) return

        const title = $('.item-title', manga).text().trim()
            || $('img', manga).attr('alt')?.trim()
            || 'Unknown Title'

        const image = `mangaId=${id}`

        mangas.push(
            App.createSourceManga({
                id,
                mangaInfo: App.createMangaInfo({
                    titles: [title],
                    image,
                    status: 'Ongoing',
                    author: '',
                    artist: '',
                    tags: [],
                    desc: ''
                })
            })
        )
    })

    return mangas
}


// =========================
// ✅ SEARCH
// =========================

export const parseSearch = (
    $: CheerioAPI,
    langSearchFilter: boolean,
    langs: string[]
): SourceManga[] => {

    const results: SourceManga[] = []

    $('.series-list .col.item, .series-list .item').each((_, manga) => {
        const id = $('a', manga).attr('href')?.split('/series/')[1]?.split(/[/?#]/)[0]
        if (!id) return

        // Language handling as before
        let lang = BTLanguages.getLangCode($('.item-lang', manga).text().trim() || '')
        if (lang === 'Unknown') lang = '🇬🇧'

        if (langSearchFilter && !langs.includes(lang)) return

        const title = $('.item-title', manga).text().trim()
            || $('img', manga).attr('alt')?.trim()
            || 'Unknown Title'

        const image = `mangaId=${id}`

        results.push(
            App.createSourceManga({
                id,
                mangaInfo: App.createMangaInfo({
                    titles: [title],
                    image,
                    status: 'Ongoing',
                    author: '',
                    artist: '',
                    tags: [],
                    desc: ''
                })
            })
        )
    })

    return results
}

// =========================
// ✅ TAGS
// =========================

export function parseTags(): TagSection[] {
    return [
        App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: []
        })
    ]
}

// =========================
// ✅ PAGING
// =========================

export function isLastPage($: CheerioAPI): boolean {
    return $('.pagination .next').length === 0
}
