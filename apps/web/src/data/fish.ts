import katsuo from '../assets/fish/katsuo.jpg';
import sanma from '../assets/fish/sanma.svg';
import saba from '../assets/fish/saba.svg';
import hotate from '../assets/fish/hotate.svg';
import maguro from '../assets/fish/maguro.jpg';
import awabi from '../assets/fish/awabi.jpg';
import { previewLots } from './preview-lots';

export type Locale = 'en' | 'ja';
export const fish = [
  { slug: 'katsuo', name: 'Katsuo', ja: 'カツオ', english: 'Skipjack tuna', category: 'tuna', image: katsuo, tone: 'blue', source: 'File:Skipjack_Tuna.jpg', author: 'Krw130lm', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  { slug: 'sanma', name: 'Sanma', ja: 'サンマ', english: 'Pacific saury', category: 'fish', image: sanma, tone: 'yellow', source: 'File:202408_Pacific_saury.svg', author: 'DBCLS', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  { slug: 'saba', name: 'Saba', ja: 'サバ', english: 'Chub mackerel', category: 'fish', image: saba, tone: 'pink', source: 'File:202408_Chub_mackerel.svg', author: 'DBCLS', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  { slug: 'hotate', name: 'Hotate', ja: 'ホタテ', english: 'Japanese scallop', category: 'shellfish', image: hotate, tone: 'lime', source: 'File:202408_Japanese_scallop.svg', author: 'DBCLS', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  { slug: 'maguro', name: 'Mebachi', ja: 'メバチマグロ', english: 'Bigeye tuna', category: 'tuna', image: maguro, tone: 'blue', source: 'File:Bigeye_tuna_on_ice.jpg', author: 'NOAA', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:Bigeye_tuna_on_ice.jpg' },
  { slug: 'awabi', name: 'Awabi', ja: 'アワビ', english: 'Ezo abalone', category: 'shellfish', image: awabi, tone: 'yellow', source: 'File:Haliotis_discus_hannai_001.jpg', author: 'Jan Delsing', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:Haliotis_discus_hannai_001.jpg' },
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
    search: 'Search fish', searchHint: 'Try saba, tuna or サバ', preview: 'Market preview', note: 'Sample lots and prices. Images show the species, not the actual lot.',
    price: 'Guide price', settlement: 'Settlement: JPYC', details: 'Lot details', weight: 'Weight', length: 'Length', review: 'Review pending', audit: 'No activity recorded for this preview lot.',
    empty: 'No fish match. Try another search or category.', count: 'species shown', credits: 'Image credits', creditNote: 'Reference images, resized for display. No endorsement implied.', landingCredit: 'Katsuo landing, Omaezaki',
  },
  ja: {
    title: '魚市場', region: '日本の太平洋沿岸', hero: '海のごちそう、見つけよう。', lead: '海をもっと身近に。魚を知って、市場を楽しもう。',
    shop: '魚を探す', all: 'すべて', fish: '鮮魚', tuna: 'マグロ・カツオ', shellfish: '貝類', browse: '魚を探す', collection: '魚のラインナップ',
    search: '魚を検索', searchHint: 'サバ、マグロ、saba など', preview: '市場プレビュー', note: '魚と価格はデモ用です。画像は魚種の参考画像で、出品物そのものではありません。',
    price: '参考価格', settlement: '決済通貨：JPYC', details: '商品情報', weight: '重量', length: '全長', review: '確認待ち', audit: 'このプレビュー商品の取引履歴はありません。',
    empty: '該当する魚がありません。検索語やカテゴリーを変えてください。', count: '種類を表示', credits: '画像クレジット', creditNote: '参考画像を表示用に縮小しています。提供元による推奨を示すものではありません。', landingCredit: '御前崎のカツオ水揚げ',
  },
} as const;
