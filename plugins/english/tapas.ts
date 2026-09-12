import { fetchText } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

const API_URL = 'https://api.tapas.io/v3';
const SITE_URL = 'https://tapas.io';
const DEVICE_UUID = '0123456789abcdef';
const DEFAULT_GENRE = '16';

type TapasImage = {
  width?: number;
  height?: number;
  file_size?: number;
  file_url?: string;
};

type TapasCreator = {
  id?: number;
  uname?: string;
  display_name?: string;
  profile_pic_url?: string;
};

type TapasGenre = {
  id: number;
  name: string;
  abbr?: string;
  books?: boolean;
};

type TapasBadge = {
  type?: string;
  period?: number;
};

type TapasSeries = {
  id: number;
  title: string;
  type?: string;
  sale_type?: string;
  description?: string;
  blurb?: string;
  thumb?: TapasImage;
  thumb_url?: string;
  book_cover_url?: string | null;
  creators?: TapasCreator[];
  genre?: TapasGenre;
  tags?: string[];
  completed?: boolean;
  timer_interval?: number | null;
  wop_interval?: number | null;
  badges?: TapasBadge[];
};

type TapasEpisodeMeta = {
  id: number;
  title?: string;
  scene?: number;
  free?: boolean;
  must_pay?: boolean;
  unlocked?: boolean;
  early_access?: boolean;
  nsfw?: boolean;
  created_date?: string;
  thumb?: TapasImage;
};

type TapasEpisode = TapasEpisodeMeta & {
  contents?: TapasImage[];
};

type SeriesPage = {
  series?: TapasSeries[];
  pagination?: { page?: number; has_next?: boolean; sort?: string };
};

type SearchPage = {
  result?: { series: TapasSeries }[];
  pagination?: { page?: number; has_next?: boolean };
};

const SORT_OPTIONS = [
  { label: 'Popular', value: 'POPULARITY' },
  { label: 'New', value: 'NEWEST' },
  { label: 'Recently updated', value: 'UPDATED' },
  { label: 'Trending', value: 'TRENDING' },
  { label: 'Oldest', value: 'OLDEST' },
  { label: 'Most liked', value: 'LIKE' },
  { label: 'Most viewed', value: 'VIEW' },
];

class TapasPlugin implements Plugin.PluginBase {
  id = 'tapas';
  name = 'Tapas';
  icon = 'src/en/tapas/icon.png';
  site = SITE_URL;
  version = '0.1.0';

  private genreOptions: { label: string; value: string }[] | null = null;

  private async api<T>(path: string): Promise<T | null> {
    const body = await fetchText(`${API_URL}/${path}`, {
      headers: {
        Accept: 'application/panda+json',
        'x-device-type': 'ANDROID',
        'x-device-uuid': DEVICE_UUID,
      },
    });
    if (!body) return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }

  private async loadGenres(force = false): Promise<void> {
    if (!force && this.genreOptions) return;
    const genres = await this.api<TapasGenre[]>('genres?books=true');
    if (!genres) return;
    this.genreOptions = genres.map(genre => ({
      label: genre.name,
      value: String(genre.id),
    }));
  }

  private toNovel(series: TapasSeries): Plugin.NovelItem {
    return {
      name: series.title,
      path: `series:${series.id}`,
      cover:
        series.book_cover_url ||
        series.thumb?.file_url ||
        series.thumb_url ||
        defaultCover,
    };
  }

  private isLocked(episode: TapasEpisodeMeta): boolean {
    return !episode.free || !!episode.must_pay;
  }

  private formatDuration(seconds?: number | null): string {
    if (!seconds || seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    const parts: string[] = [];
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  private async lockMessage(
    seriesId: number,
    episode: TapasEpisode,
  ): Promise<string> {
    const title = episode.title ? `"${episode.title}"` : 'This episode';
    const series = await this.api<TapasSeries>(`series/${seriesId}`);
    if (episode.must_pay || series?.sale_type === 'PAID') {
      return `🔒 ${title} is locked on Tapas and must be purchased. Unlock it in the Tapas app or on tapas.io to read it here.`;
    }
    const seconds =
      series?.timer_interval ||
      series?.wop_interval ||
      series?.badges?.find(badge => badge.period)?.period;
    const wait = this.formatDuration(seconds);
    return wait
      ? `🔒 ${title} is locked on Tapas. Its wait-or-pay timer is ${wait}; unlock it in the Tapas app or on tapas.io to read it here.`
      : `🔒 ${title} is locked on Tapas. Unlock it in the Tapas app or on tapas.io to read it here.`;
  }

  get filters() {
    return {
      genre: {
        label: 'Genre',
        type: FilterTypes.Picker,
        value: DEFAULT_GENRE,
        options: this.genreOptions ?? [
          { label: 'Romance', value: DEFAULT_GENRE },
        ],
      },
      sort: {
        label: 'Sort',
        type: FilterTypes.Picker,
        value: 'POPULARITY',
        options: SORT_OPTIONS,
      },
    } satisfies Filters;
  }

  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    await this.loadGenres();

    const page = Math.max(pageNo, 1);
    const genre = filters?.genre?.value || DEFAULT_GENRE;
    const sort = filters?.sort?.value || 'POPULARITY';

    const data = await this.api<SeriesPage>(
      `genres/${genre}/series?page=${page}&sort=${encodeURIComponent(sort)}`,
    );
    return (data?.series ?? []).map(series => this.toNovel(series));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const page = Math.max(pageNo, 1);
    const data = await this.api<SearchPage>(
      `search/books?q=${encodeURIComponent(term)}&page=${page}`,
    );
    return (data?.result ?? []).map(item => this.toNovel(item.series));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const seriesId = Number(novelPath.replace(/^series:/, ''));
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: 'Untitled',
      cover: defaultCover,
      chapters: [],
    };
    if (!seriesId) return novel;

    const [series, episodes] = await Promise.all([
      this.api<TapasSeries>(`series/${seriesId}`),
      this.api<TapasEpisodeMeta[]>(`series/${seriesId}/episodes`),
    ]);

    if (series) {
      novel.name = series.title || novel.name;
      novel.cover =
        series.book_cover_url || series.thumb?.file_url || defaultCover;
      novel.summary = series.description || series.blurb || '';
      novel.author = (series.creators ?? [])
        .map(creator => creator.display_name)
        .filter(Boolean)
        .join(', ');
      novel.artist = novel.author;
      novel.genres = [series.genre?.name, ...(series.tags ?? [])]
        .filter(Boolean)
        .join(',');
      novel.status = series.completed
        ? NovelStatus.Completed
        : NovelStatus.Ongoing;
    }

    novel.chapters = (episodes ?? [])
      .slice()
      .sort((a, b) => (a.scene ?? 0) - (b.scene ?? 0))
      .map(episode => ({
        name:
          (this.isLocked(episode) ? '🔒 ' : '') +
          (episode.title || `Episode ${episode.scene ?? ''}`),
        path: `episode:${seriesId}:${episode.id}`,
        chapterNumber: episode.scene,
        releaseTime: episode.created_date,
      }));

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const [, seriesIdRaw, episodeIdRaw] = chapterPath.split(':');
    const seriesId = Number(seriesIdRaw);
    const episodeId = Number(episodeIdRaw);
    if (!seriesId || !episodeId) return '<p>Invalid chapter.</p>';

    const episode = await this.api<TapasEpisode>(
      `series/${seriesId}/episodes/${episodeId}`,
    );
    if (!episode) return '<p>Could not load this chapter.</p>';

    if (this.isLocked(episode)) {
      throw new Error(await this.lockMessage(seriesId, episode));
    }

    const contents = (episode.contents ?? []).filter(item => item.file_url);
    const first = contents[0];
    if (first?.file_url && /\.html(\?|$)/.test(first.file_url)) {
      const page = await fetchText(`${SITE_URL}/episode/${episodeId}`);
      if (page) {
        const $ = parseHTML(page);
        const article = $('article.viewer__body').first();
        const body = article.length ? article.html() : null;
        if (body && body.trim()) return body;
      }
      const html = await fetchText(first.file_url);
      if (html && html.indexOf('<') !== -1) {
        const $ = parseHTML(html);
        const body = $('#viewport').html() ?? $('body').html();
        if (body) return body;
      }
      return '<p>Could not load this chapter.</p>';
    }

    if (!contents.length) return '<p>This chapter is empty.</p>';
    return contents.map(item => `<img src="${item.file_url}" />`).join('\n');
  }

  resolveUrl = (path: string, isNovel?: boolean) => {
    if (isNovel) {
      return `${SITE_URL}/series/${path.replace(/^series:/, '')}`;
    }
    const episodeId = path.split(':')[2];
    return `${SITE_URL}/episode/${episodeId ?? path}`;
  };
}

export default new TapasPlugin();
