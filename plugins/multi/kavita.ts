import { fetchText } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { storage } from '@libs/storage';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

type SeriesDto = {
  id: number;
  name: string;
  summary?: string;
};

type SeriesMetadataDto = {
  summary?: string;
  publicationStatus?: number;
  genres?: { title?: string; name?: string }[];
  tags?: { title?: string; name?: string }[];
  writers?: { name?: string }[];
};

type VolumeDto = {
  id: number;
  name?: string;
  number?: number;
  chapters?: ChapterDto[];
};

type ChapterDto = {
  id: number;
  title?: string;
  titleName?: string;
  number?: string;
  pages?: number;
};

type BookInfoDto = {
  seriesFormat?: number;
  pages?: number;
  bookTitle?: string;
};

const FORMAT_NAMES: Record<number, string> = {
  0: 'image',
  1: 'archive',
  2: 'unknown',
  3: 'epub',
  4: 'pdf',
};

type OpdsLink = {
  rel?: string;
  type?: string;
  href?: string;
};

type OpdsEntry = {
  title?: string;
  id?: string;
  links: OpdsLink[];
};

type FilterOption = {
  label: string;
  value: string;
};

class KavitaPlugin implements Plugin.PluginBase {
  id = 'kavita';
  name = 'Kavita';
  icon = 'src/multi/kavita/icon.png';
  site = (storage.get('url') as string) || '';
  version = '0.1.3';

  private libraryCache: { key: string; options: FilterOption[] } | null = null;

  private get baseUrl(): string {
    const url = (storage.get('url') as string) || '';
    return url.replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return (storage.get('apiKey') as string) || '';
  }

  private get configured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const all: Record<string, string> = { ...params };
    if (this.apiKey) all.apiKey = this.apiKey;
    const query = Object.keys(all)
      .filter(key => all[key] !== '')
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(all[key])}`)
      .join('&');
    return `${this.baseUrl}/api/${path}${query ? `?${query}` : ''}`;
  }

  private absolute(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) {
      const scheme =
        this.baseUrl.match(/^[a-z][a-z0-9+.-]*:/i)?.[0] ?? 'https:';
      return `${scheme}${url}`;
    }
    return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private async requestText(
    path: string,
    params: Record<string, string> = {},
  ): Promise<string> {
    const url = this.url(path, params);
    const body = await fetchText(url);
    if (!body) {
      console.error(`[Kavita] Empty response from ${url}`);
    }
    return body;
  }

  private async requestJson<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T | null> {
    const body = await this.requestText(path, params);
    if (!body) return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }

  private parseFeed(xml: string): OpdsEntry[] {
    if (!xml) return [];
    const $ = parseHTML(xml, { xmlMode: true });
    const entries: OpdsEntry[] = [];
    $('entry').each((_, el) => {
      const links: OpdsLink[] = [];
      $(el)
        .find('link')
        .each((__, link) => {
          links.push({
            rel: $(link).attr('rel'),
            type: $(link).attr('type'),
            href: $(link).attr('href'),
          });
        });
      entries.push({
        title: $(el).find('title').first().text(),
        id: $(el).find('id').first().text(),
        links,
      });
    });
    return entries;
  }

  private entryToNovel(entry: OpdsEntry): Plugin.NovelItem | undefined {
    const href = entry.links.find(
      link =>
        link.rel === 'subsection' || link.type?.includes('kind=acquisition'),
    )?.href;
    const match = href?.match(/series\/(\d+)/);
    if (!match) return undefined;
    const id = Number(match[1]);
    const cover = entry.links.find(
      link =>
        (link.rel || '').includes('thumbnail') ||
        (link.rel || '').includes('image'),
    )?.href;
    return {
      name: entry.title || `Series ${id}`,
      path: `series:${id}`,
      cover: cover ? this.absolute(cover) : defaultCover,
    };
  }

  private seriesToNovel(series: SeriesDto): Plugin.NovelItem {
    return {
      name: series.name,
      path: `series:${series.id}`,
      cover: this.url('image/series-cover', { seriesId: String(series.id) }),
    };
  }

  private async loadLibraries(force = false): Promise<void> {
    const key = `${this.baseUrl}|${this.apiKey}`;
    if (!force && this.libraryCache?.key === key) return;

    const xml = await this.requestText(`opds/${this.apiKey}/libraries`);
    const options: FilterOption[] = [];
    for (const entry of this.parseFeed(xml)) {
      const href = entry.links.find(link => link.rel === 'subsection')?.href;
      const match = href?.match(/libraries\/(\d+)/);
      if (!match) continue;
      options.push({
        label: entry.title || `Library ${match[1]}`,
        value: match[1],
      });
    }
    this.libraryCache = { key, options };
  }

  private parseId(path: string, kind: string): number | undefined {
    const match = path.match(new RegExp(`^${kind}:(\\d+)$`));
    return match ? Number(match[1]) : undefined;
  }

  private mapStatus(status?: number): string {
    switch (status) {
      case 0:
        return NovelStatus.Ongoing;
      case 1:
        return NovelStatus.OnHiatus;
      case 2:
      case 4:
        return NovelStatus.Completed;
      case 3:
        return NovelStatus.Cancelled;
      default:
        return NovelStatus.Unknown;
    }
  }

  private async allSeries(pageNo: number): Promise<Plugin.NovelItem[]> {
    const body = await fetchText(
      this.url('Series/all-v2', {
        pageNumber: String(Math.max(pageNo, 1)),
        pageSize: '50',
      }),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statements: [] }),
      },
    );
    if (!body) return [];
    try {
      const series = JSON.parse(body) as SeriesDto[];
      return series.map(item => this.seriesToNovel(item));
    } catch {
      return [];
    }
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (!this.configured) return [];

    if (pageNo <= 1) {
      await this.loadLibraries(true);
    }

    const libraryId = filters?.library.value || '';

    if (!showLatestNovels && !libraryId) {
      return await this.allSeries(pageNo);
    }

    const path =
      showLatestNovels || !libraryId
        ? `opds/${this.apiKey}/recently-added`
        : `opds/${this.apiKey}/libraries/${libraryId}`;

    const xml = await this.requestText(path, {
      pageNumber: String(Math.max(pageNo, 1)),
    });

    return this.parseFeed(xml)
      .map(entry => this.entryToNovel(entry))
      .filter((novel): novel is Plugin.NovelItem => !!novel);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (!this.configured) return [];

    const xml = await this.requestText(`opds/${this.apiKey}/series`, {
      query: searchTerm,
      pageNumber: String(Math.max(pageNo, 1)),
    });

    return this.parseFeed(xml)
      .map(entry => this.entryToNovel(entry))
      .filter((novel): novel is Plugin.NovelItem => !!novel);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: 'Untitled',
      cover: defaultCover,
      chapters: [],
    };

    const seriesId = this.parseId(novelPath, 'series');
    if (seriesId === undefined || !this.configured) return novel;

    const [series, metadata] = await Promise.all([
      this.requestJson<SeriesDto>(`Series/${seriesId}`),
      this.requestJson<SeriesMetadataDto>('Series/metadata', {
        seriesId: String(seriesId),
      }),
    ]);

    if (series) {
      novel.name = series.name || novel.name;
      novel.cover = this.url('image/series-cover', {
        seriesId: String(seriesId),
      });
    }

    if (metadata) {
      novel.summary = metadata.summary || '';
      novel.author = (metadata.writers || [])
        .map(writer => writer.name)
        .filter(Boolean)
        .join(', ');
      novel.genres = [...(metadata.genres || []), ...(metadata.tags || [])]
        .map(tag => tag.title || tag.name)
        .filter(Boolean)
        .join(', ');
      novel.status = this.mapStatus(metadata.publicationStatus);
    }

    const volumes =
      (await this.requestJson<VolumeDto[]>('Series/volumes', {
        seriesId: String(seriesId),
      })) || [];

    const chapters: Plugin.ChapterItem[] = [];
    for (const volume of volumes) {
      const volumeChapters =
        volume.chapters ||
        (await this.requestJson<ChapterDto[]>('Series/chapter', {
          volumeId: String(volume.id),
        })) ||
        [];

      for (const chapter of volumeChapters) {
        const name =
          chapter.title ||
          chapter.titleName ||
          `Volume ${volume.number ?? '?'} Chapter ${chapter.number ?? '?'}`;
        chapters.push({
          name,
          path: `chapter:${chapter.id}`,
          chapterNumber: Number(chapter.number) || undefined,
        });
      }
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterId = this.parseId(chapterPath, 'chapter');
    if (chapterId === undefined || !this.configured) {
      return '<p>Kavita is not configured. Set the server URL and API key in the plugin settings.</p>';
    }

    const info = await this.requestJson<BookInfoDto>(
      `Book/${chapterId}/book-info`,
    );
    const format = info?.seriesFormat;
    const pages = info?.pages ?? 0;

    if (format === 3) {
      const parts: string[] = [];
      for (let page = 0; page < pages; page++) {
        const html = await this.readBookPage(chapterId, page);
        if (html) parts.push(html);
      }
      return parts.join('\n') || '<p>No readable pages were returned.</p>';
    }

    if (format === 0 || format === 1) {
      const images: string[] = [];
      for (let page = 0; page < pages; page++) {
        images.push(
          `<img src="${this.url('Reader/image', {
            chapterId: String(chapterId),
            page: String(page),
          })}" />`,
        );
      }
      return images.join('\n');
    }

    return `<p>Kavita reports this chapter as "${FORMAT_NAMES[format ?? -1] || 'unknown'}", which cannot be rendered as text.</p>`;
  }

  private async readBookPage(chapterId: number, page: number): Promise<string> {
    const body = await fetchText(
      this.url(`Book/${chapterId}/book-page`, { page: String(page) }),
    );
    if (!body) return '';

    let html = body;
    if (html.trimStart().startsWith('"')) {
      try {
        html = JSON.parse(html) as string;
      } catch {
        // keep the raw body if it was not a JSON string
      }
    }
    return this.absolutize(html);
  }

  private absolutize(html: string): string {
    const $ = parseHTML(html);
    $('[src^="/"]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) $(el).attr('src', this.absolute(src));
    });
    $('[href^="/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) $(el).attr('href', this.absolute(href));
    });
    const body = $('body');
    return body.length ? (body.html() ?? '') : $.html();
  }

  resolveUrl = (path: string, isNovel?: boolean) => {
    if (isNovel) {
      return this.url(`Series/${path.replace(/^series:/, '')}`);
    }
    return this.url(`Book/${path.replace(/^chapter:/, '')}/book-page`, {
      page: '0',
    });
  };

  get filters() {
    return {
      library: {
        value: '',
        label: 'Library',
        type: FilterTypes.Picker,
        options: [
          { label: 'All libraries', value: '' },
          ...(this.libraryCache?.options ?? []),
        ],
      },
    } satisfies Filters;
  }

  pluginSettings = {
    url: {
      value: '',
      label: 'Kavita server URL (e.g. http://192.168.1.10:5000)',
    },
    apiKey: {
      value: '',
      label: 'API key (Kavita -> User Settings -> 3rd Party Clients)',
    },
  };
}

export default new KavitaPlugin();
