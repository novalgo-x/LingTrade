import type { SentimentInputItem, SourceReference } from "../domain/types.js";

export interface XueqiuConfig {
  token: string;
  timeout?: number;
}

interface XueqiuPost {
  id: number;
  text: string;
  title?: string;
  created_at: number;
  user: {
    screen_name: string;
    followers_count: number;
  };
  fav_count: number;
  reply_count: number;
  retweet_count: number;
}

interface XueqiuQuote {
  symbol: string;
  name: string;
  current: number;
  percent: number;
  volume: number;
  market_capital: number;
}

export class XueqiuDataSource {
  private readonly baseUrl = "https://xueqiu.com";
  private readonly stockApiUrl = "https://stock.xueqiu.com";
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(config: XueqiuConfig) {
    this.headers = {
      "Cookie": `xq_a_token=${config.token}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    this.timeout = config.timeout ?? 30000;
  }

  async fetchStockPosts(ticker: string, count = 20): Promise<SentimentInputItem[]> {
    const xqSymbol = this.normalizeTickerToXueqiu(ticker);
    const url = `${this.baseUrl}/query/v1/symbol/search/status?count=${count}&comment=0&symbol=${xqSymbol}&hl=0&source=all&sort=time&page=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Xueqiu posts API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const posts: XueqiuPost[] = data.list || [];

      return posts.map((post) => this.mapPostToSentimentItem(post, ticker));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchStockQuote(ticker: string): Promise<XueqiuQuote | null> {
    const xqSymbol = this.normalizeTickerToXueqiu(ticker);
    const url = `${this.stockApiUrl}/v5/stock/quote.json?symbol=${xqSymbol}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Xueqiu quote API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data?.quote || null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private normalizeTickerToXueqiu(ticker: string): string {
    if (ticker.includes(".")) {
      return ticker.replace(".", "");
    }

    if (ticker.startsWith("6")) {
      return `SH${ticker}`;
    } else if (ticker.startsWith("0") || ticker.startsWith("3")) {
      return `SZ${ticker}`;
    } else if (ticker.startsWith("8") || ticker.startsWith("4")) {
      return `BJ${ticker}`;
    }

    return ticker;
  }

  private mapPostToSentimentItem(post: XueqiuPost, ticker: string): SentimentInputItem {
    const source: SourceReference = {
      name: "Xueqiu",
      type: "social",
      url: `https://xueqiu.com/status/${post.id}`,
      credibility: "medium",
      commercialUse: "restricted",
      retrievedAt: new Date().toISOString(),
      note: `Posted by ${post.user.screen_name} (${post.user.followers_count} followers)`,
    };

    const engagement = post.fav_count + post.reply_count + post.retweet_count;

    return {
      sourceType: "social",
      title: post.title || post.text.slice(0, 50),
      summary: this.stripHtml(post.text).slice(0, 200),
      publishedAt: new Date(post.created_at).toISOString(),
      engagement,
      source,
    };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  }
}
