
import {
    Chapter,
    ChapterDetails,
    HomeSection,
    Manga,
    Tag,
    TagSection
} from '@paperback/types'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CryptoJS = require('./external/crypto-js.min.js')


// ===============================
// MANGA DETAILS
// ===============================
export const parseMangaDetails = ($: CheerioStatic, mangaId: string): Manga => {
    const title = $('div.epsleft > span').first().text().trim()
    const image = $('div.cover img').attr('src')!
    const desc = $('div.limit-html').text().trim()

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: {
            title,
            image,
            desc,
            status: 'Unknown'
        }
    })
}

// ===============================
// CHAPTER LIST
// ===============================
export const parseChapterList = ($: CheerioStatic, mangaId: string): Chapter[] => {
    const chapters: Chapter[] = []

    $('div.episode-list > div').each((_, el) => {
        const link = $('a', el)
        const id = link.attr('href')?.split('/').pop() ?? ''
        const name = $('span', el).first().text().trim()

        chapters.push(App.createChapter({
            id,
            mangaId,
            name,
            langCode: 'EN'
        }))
    })

    return chapters
}

// ===============================
// CHAPTER DETAILS (IMAGES)
// ===============================
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

    // ✅ CRITICAL: ONE UNIQUE URL PER PAGE
    const pages = imgList.map((value: string, index: number) => {
        return `${value}?${tknList[index]}`
    })

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

// ===============================
// HOME SECTIONS
// ===============================
export const parseHomeSections = ($: CheerioStatic, sectionCallback: (section: HomeSection) => void): void => {
    const homeSections: HomeSection[] = [
        App.createHomeSection({ id: 'popular_updates', title: 'Popular Updates' }),
        App.createHomeSection({ id: 'latest_releases', title: 'Latest Releases' })
    ]

    homeSections.forEach(section => {
        $('div.item').each((_, el) => {
            const id = $('a', el).attr('href')?.split('/').pop() ?? ''
            const title = $('img', el).attr('alt')?.trim() ?? ''
            const image = $('img', el).attr('src') ?? ''

            section.items.push(App.createSourceManga({
                id,
                mangaInfo: {
                    title,
                    image
                }
            }))
        })

        sectionCallback(section)
    })
}

// ===============================
// VIEW MORE
// ===============================
export const parseViewMore = ($: CheerioStatic): Manga[] => {
    const manga: Manga[] = []

    $('div.item').each((_, el) => {
        const id = $('a', el).attr('href')?.split('/').pop() ?? ''
        const title = $('img', el).attr('alt') ?? ''
        const image = $('img', el).attr('src') ?? ''

        manga.push(App.createSourceManga({
            id,
            mangaInfo: { title, image }
        }))
    })

    return manga
}

// ===============================
// SEARCH
// ===============================
export const parseSearch = ($: CheerioStatic): Manga[] => {
    const manga: Manga[] = []

    $('div.item').each((_, el) => {
        const id = $('a', el).attr('href')?.split('/').pop() ?? ''
        const title = $('img', el).attr('alt') ?? ''
        const image = $('img', el).attr('src') ?? ''

        manga.push(App.createSourceManga({
            id,
            mangaInfo: { title, image }
        }))
    })

    return manga
}

// ===============================
// TAGS
// ===============================
export const parseTags = (): TagSection[] => {
    return [
        App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: [
                App.createTag({ id: 'action', label: 'Action' }),
                App.createTag({ id: 'romance', label: 'Romance' }),
                App.createTag({ id: 'comedy', label: 'Comedy' }),
                App.createTag({ id: 'fantasy', label: 'Fantasy' }),
                App.createTag({ id: 'drama', label: 'Drama' })
            ]
        })
    ]
}

// ===============================
// PAGINATION
// ===============================
export const isLastPage = ($: CheerioStatic): boolean => {
    return $('li.page-item.active + li.page-item').length === 0
}

export function parseThumbnailUrl($: CheerioAPI): string {
    const img =
        $('meta[property="og:image"]').attr('content') ||
        $('div.series-cover img').attr('src') ||
        $('img').first().attr('src')

    if (!img) {
        throw new Error('Failed to locate thumbnail image')
    }

    if (img.startsWith('//')) return `https:${img}`
    if (img.startsWith('/')) return `https://bato.to${img}`

    return img
}

