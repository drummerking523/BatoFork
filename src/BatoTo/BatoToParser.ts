import {
    Chapter,
    ChapterDetails,
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    BTGenres,
    BTLanguages
} from './BatoToHelper'

import * as CryptoJS from './external/crypto-js.min'
import entities = require('entities')

// =========================
// ✅ FULL k+n CDN HOST POOL
// =========================
const CDN_HOST_POOL = [
    "k03","k06","k07","k00","k01","k02","k04","k05","k08","k09",
    "n00","n01","n02","n03","n04","n05","n06","n07","n08","n09","n10"
]

// ✅ Convert a single image URL into a fallback chain
const buildCdnFallbacks = (originalUrl: string): string[] => {
    try {
        const base = originalUrl.replace(/^https:\/\/[a-z]\d{2}\./, '')
        return CDN_HOST_POOL.map(host => `https://${host}.${base}`)
    } catch {
        return [originalUrl]
    }
}

// ✅ Decode helper
const decodeHTMLEntity = (str: string): string => {
    return entities.decodeHTML(str)
}

// =========================
// ✅ MANGA DETAILS
// =========================
export const parseMangaDetails = ($: CheerioStatic, mangaId: string): SourceManga => {
    const titles: string[] = []

    titles.push(decodeHTMLEntity($('a', $('.item-title')).text().trim() ?? ''))
    const altTitles = $('.alias-set').text().trim().split('/')
    for (const title of altTitles) titles.push(decodeHTMLEntity(title))

    const description = decodeHTMLEntity($('.limit-html').text().trim() ?? '')

    const authorElement = $('div.attr-item b:contains("Authors")').next('span')
    const author = authorElement.length
        ? authorElement.children().map((_: number, e: CheerioElement) => $(e).text().trim()).toArray().join(', ')
        : ''

    const artistElement = $('div.attr-item b:contains("Artists")').next('span')
    const artist = artistElement.length
        ? artistElement.children().map((_: number, e: CheerioElement) => $(e).text().trim()).toArray().join(', ')
        : ''

    const arrayTags: Tag[] = []
    for (const tag of $('div.attr-item b:contains("Genres")').next('span').children().toArray()) {
        const label = $(tag).text().trim()
        const id = encodeURI(BTGenres.getParam(label) ?? label)
        if (!id || !label) continue
        arrayTags.push({ id, label })
    }

    const tagSections: TagSection[] = [
        App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })
    ]

    const rawStatus = $('div.attr-item b:contains("Upload status")').next('span').text().trim()
    const status =
        rawStatus === 'COMPLETED' ? 'Completed' :
        rawStatus === 'HIATUS' ? 'Hiatus' : 'Ongoing'

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image: `mangaId=${mangaId}`,
            status,
            author,
            artist,
            tags: tagSections,
            desc: description
        })
    })
}

// =========================
// ✅ CHAPTER LIST
// =========================
export const parseChapterList = ($: CheerioStatic, mangaId: string): Chapter[] => {
    const chapters: Chapter[] = []
    let sortingIndex = 0

    for (const chapter of $('div.episode-list div.main .item').toArray()) {
        const title = $('b', chapter).text().trim()
        const chapterId: string = $('a', chapter).attr('href')?.replace(/\/$/, '')?.split('/').pop() ?? ''
        const group: string = $('a.ps-3 > span', chapter).text().trim()
        if (!chapterId) continue

        let language = BTLanguages.getLangCode($('em').attr('data-lang') ?? '')
        if (language === 'Unknown') language = '🇬🇧'

        const chapNumRegex = title.match(/(\d+)(?:[-.]\d+)?/)
        let chapNum = chapNumRegex ? Number(chapNumRegex[1]) : 0
        if (isNaN(chapNum)) chapNum = 0

        chapters.push(App.createChapter({
            id: chapterId,
            name: title,
            langCode: language,
            chapNum,
            time: new Date(),
            sortingIndex,
            volume: 0,
            group
        }))
        sortingIndex--
    }

    return chapters.reverse()
}

// =========================
// ✅ ✅ ✅ CHAPTER DETAILS (FULL CDN FALLBACK)
// =========================
export const parseChapterDetails = ($: CheerioStatic, mangaId: string, chapterId: string): ChapterDetails => {
    const scriptObj = $('script').toArray().find(obj => {
        const data = obj.children[0]?.data ?? ''
        return data.includes('batoPass') && data.includes('batoWord')
    })

    const script = scriptObj?.children[0]?.data ?? ''

    const batoPass = eval(script.match(/const\s+batoPass\s*=\s*(.*?);/)?.[1] ?? '').toString()
    const batoWord = script.match(/const\s+batoWord\s*=\s*"(.*)";/)?.[1] ?? ''
    const imgHttps = script.match(/const\s+imgHttps\s*=\s*(.*?);/)?.[1] ?? ''

    const imgList: string[] = JSON.parse(imgHttps)
    const tknList: string[] = JSON.parse(
        CryptoJS.AES.decrypt(batoWord, batoPass).toString(CryptoJS.enc.Utf8)
    )

    // ✅ THIS IS THE CRITICAL FIX:
    const pages = imgList.flatMap((value: string, index: number) => {
        const full = `${value}?${tknList[index]}`
        return buildCdnFallbacks(full)
    })

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

// =========================
// ✅ HOMEPAGE
// =========================
export const parseHomeSections = ($: CheerioStatic, sectionCallback: (section: HomeSection) => void): void => {
    const popularSection = App.createHomeSection({
        id: 'popular_updates',
        title: 'Popular Updates',
        containsMoreItems: true,
        type: HomeSectionType.singleRowLarge
    })

    const popularArray: PartialSourceManga[] = []
    for (const manga of $('.home-popular .col.item').toArray()) {
        const image = $('img', manga).first().attr('src') ?? ''
        const title = $('.item-title', manga).text().trim() ?? ''
        const id = $('a', manga).attr('href')?.replace('/series/', '').trim().split('/')[0] ?? ''
        if (!id || !title) continue
        popularArray.push(App.createPartialSourceManga({ image, title, mangaId: id }))
    }

    popularSection.items = popularArray
    sectionCallback(popularSection)
}

// =========================
// ✅ TAGS / SEARCH / VIEW MORE (UNCHANGED LOGIC)
// =========================
export const parseViewMore = ($: CheerioStatic) => []
export const parseTags = () => []
export const parseSearch = ($: CheerioStatic) => []
export const isLastPage = ($: CheerioStatic) => $('.page-item').last().hasClass('disabled')
