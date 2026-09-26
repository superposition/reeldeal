export type PreviewLot = {
  id: string;
  species: string;
  lengthMm: number;
  weightG: number;
  priceJpy: number;
  status: string;
  note: string;
};

// Static preview content until RD-25's seed and RD-18's listing API arrive.
export const previewLots: PreviewLot[] = [
  {
    id: 'RD-LOT-001',
    species: 'Katsuo',
    lengthMm: 412,
    weightG: 1480,
    priceJpy: 2800,
    status: 'Preview lot',
    note: 'Operator-confirmed label · decision pending',
  },
  {
    id: 'RD-LOT-002',
    species: 'Sanma',
    lengthMm: 318,
    weightG: 265,
    priceJpy: 760,
    status: 'Preview lot',
    note: 'Operator-confirmed label · decision pending',
  },
  {
    id: 'RD-LOT-003',
    species: 'Saba',
    lengthMm: 365,
    weightG: 690,
    priceJpy: 1240,
    status: 'Preview lot',
    note: 'Operator-confirmed label · decision pending',
  },
];
