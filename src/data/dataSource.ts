import type { RawStockDataset } from "../domain/types.js";

export interface StockDataSource {
  readonly name: string;
  loadStockDataset(ticker: string): Promise<RawStockDataset>;
}
