import {
    Chapter,
    ChapterDetails,
    HomeSection,
    MangaProviding,
    SearchResultsProviding,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import * as CryptoJS from './external/crypto-js.min'
import { CheerioAPI } from 'cheerio'

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

export function parseHomeSections(
    $: CheerioAPI,
    sectionCallback: (section: HomeSection) => void
) {

    const results: SourceManga[] = []

    $('.item').each((_, el) => {
        const id = $(el).find('a').attr('href')?.split('/').pop()
        const title = cleanText($(el).find('.item-title').text())
        const image = normalizeUrl($(el).find('img').attr('src'))

        if (!id || !title) return

        results.push(
            App.createSourceManga({
                id,
                title,
                image,
                status: 'Unknown'
            })
        )
    })

    sectionCallback(
        App.createHomeSection({
            id: 'featured',
            title: 'Featured',
            items: results
        })
    )
}

// =========================
// ✅ VIEW MORE
// =========================

export function parseViewMore($: CheerioAPI): SourceManga[] {

    const results: SourceManga[] = []

    $('.item').each((_, el) => {
        const id = $(el).find('a').attr('href')?.split('/').pop()
        const title = cleanText($(el).find('.item-title').text())
        const image = normalizeUrl($(el).find('img').attr('src'))

        if (!id || !title) return

        results.push(
            App.createSourceManga({
                id,
                title,
                image,
                status: 'Unknown'
            })
        )
    })

    return results
}

// =========================
// ✅ SEARCH
// =========================

export function parseSearch(
    $: CheerioAPI,
    _langFilter: boolean,
    _langs: string[]
): SourceManga[] {

    const results: SourceManga[] = []

    $('.item').each((_, el) => {
        const id = $(el).find('a').attr('href')?.split('/').pop()
        const title = cleanText($(el).find('.item-title').text())
        const image = normalizeUrl($(el).find('img').attr('src'))

        if (!id || !title) return

        results.push(
            App.createSourceManga({
                id,
                title,
                image,
                status: 'Unknown'
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
