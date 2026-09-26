import katsuo from '../assets/fish/katsuo-ice.webp';
import sanma from '../assets/fish/sanma-ice.webp';
import saba from '../assets/fish/saba-ice.webp';
import hotate from '../assets/fish/hotate-ice.webp';
import maguro from '../assets/fish/maguro-ice.webp';
import awabi from '../assets/fish/awabi-ice.webp';
import { previewLots } from './preview-lots';

export type Locale = 'en' | 'ja';
export const fish = [
  { slug: 'katsuo', name: 'Katsuo', ja: 'カツオ', english: 'Skipjack tuna', category: 'tuna', image: katsuo, tone: 'blue' },
  { slug: 'sanma', name: 'Sanma', ja: 'サンマ', english: 'Pacific saury', category: 'fish', image: sanma, tone: 'yellow' },
  { slug: 'saba', name: 'Saba', ja: 'サバ', english: 'Chub mackerel', category: 'fish', image: saba, tone: 'pink' },
  { slug: 'hotate', name: 'Hotate', ja: 'ホタテ', english: 'Japanese scallop', category: 'shellfish', image: hotate, tone: 'lime' },
  { slug: 'maguro', name: 'Mebachi', ja: 'メバチマグロ', english: 'Bigeye tuna', category: 'tuna', image: maguro, tone: 'blue' },
  { slug: 'awabi', name: 'Awabi', ja: 'アワビ', english: 'Ezo abalone', category: 'shellfish', image: awabi, tone: 'yellow' },
] as const;

const samples = {
  hotate: { lengthMm: 110, weightG: 220, priceJpy: 3800 },
  maguro: { lengthMm: 1100, weightG: 18000, priceJpy: 4500 },
  awabi: { lengthMm: 95, weightG: 180, priceJpy: 12000 },
};
export const storefrontLots = fish.map((item) => ({
  ...item,
  lot: previewLots.find((lot) => lot.species.toLowerCase() === item.slug)
    ?? samples[item.slug as keyof typeof samples],
}));

export const copy = {
  en: {
    title: 'Fish market', region: 'Japan’s east coast', hero: 'Good fish. Great finds.', lead: 'A little closer to the coast. Meet the fish, explore the market.',
    shop: 'Shop the market', all: 'All seafood', fish: 'Whole fish', tuna: 'Tuna & katsuo', shellfish: 'Shellfish', browse: 'Find your fish', collection: 'Meet the catch',
    search: 'Search fish', searchHint: 'Try saba, tuna or サバ', preview: 'Market preview', note: 'Sample lots and prices. Fish images are AI-generated illustrations, not actual lot photos.',
    price: 'Guide price', settlement: 'Settlement: JPYC', details: 'Lot details', weight: 'Weight', length: 'Length', review: 'Review pending', audit: 'No activity recorded for this preview lot.',
    empty: 'No fish match. Try another search or category.', count: 'species shown', credits: 'Image credits', creditNote: 'The six fish portraits are AI-generated illustrations. The market photograph is credited below.', landingCredit: 'Katsuo landing, Omaezaki',
  },
  ja: {
    title: '魚市場', region: '日本の太平洋沿岸', hero: '海のごちそう、見つけよう。', lead: '海をもっと身近に。魚を知って、市場を楽しもう。',
    shop: '魚を探す', all: 'すべて', fish: '鮮魚', tuna: 'マグロ・カツオ', shellfish: '貝類', browse: '魚を探す', collection: '魚のラインナップ',
    search: '魚を検索', searchHint: 'サバ、マグロ、saba など', preview: '市場プレビュー', note: '魚と価格はデモ用です。魚の画像はAI生成のイメージで、出品物の写真ではありません。',
    price: '参考価格', settlement: '決済通貨：JPYC', details: '商品情報', weight: '重量', length: '全長', review: '確認待ち', audit: 'このプレビュー商品の取引履歴はありません。',
    empty: '該当する魚がありません。検索語やカテゴリーを変えてください。', count: '種類を表示', credits: '画像クレジット', creditNote: '6種類の魚の画像はAI生成のイメージです。市場の写真のクレジットは以下のとおりです。', landingCredit: '御前崎のカツオ水揚げ',
  },
} as const;
