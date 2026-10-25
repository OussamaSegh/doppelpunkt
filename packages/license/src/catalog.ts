/**
 * What can be bought or redeemed. This file is the single price/product config for the app (the
 * Unlock screen shows these prices) and the billing Worker (which accepts these SKUs and maps each
 * to a Stripe Price id through the STRIPE_PRICES variable). The amounts are display prices only:
 * Stripe charges what the Price object in the Stripe dashboard says, so keep both in sync.
 * See docs/PAYMENTS.md.
 */

/** Every level of the course. A1 is always free. */
export const ALL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CourseLevel = (typeof ALL_LEVELS)[number];

/** The levels that need an unlock. */
export const PAID_LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type PaidLevel = (typeof PAID_LEVELS)[number];

export const FREE_LEVEL: CourseLevel = 'A1';

/** Unit number that every locked level lets learners try for free. */
export const FREE_PREVIEW_UNIT = 1;

export type LevelSku = `level-${Lowercase<PaidLevel>}`;
export type Sku = LevelSku | 'pass-year' | 'book-1';

export type Price = {
  /** Minor units (Rappen / cents). */
  amount: number;
  /** ISO 4217, upper case. */
  currency: 'CHF' | 'EUR';
};

export type Product = {
  sku: Sku;
  kind: 'level' | 'pass' | 'book';
  /** English name shown in the app and on the Stripe receipt line. */
  name: string;
  description: string;
  levels: readonly PaidLevel[];
  /** Validity in days; undefined = no expiry. */
  days?: number;
  /** Display price; undefined for products that are not sold in the app (book codes). */
  price?: Price;
};

const levelProduct = (level: PaidLevel, amount: number): Product => ({
  sku: `level-${level.toLowerCase() as Lowercase<PaidLevel>}`,
  kind: 'level',
  name: `${level} level`,
  description: `All ${level} units, the ${level} mock exam and every update to them. Yours to keep, no expiry.`,
  levels: [level],
  price: { amount, currency: 'CHF' },
});

/**
 * Display prices. PLACEHOLDERS chosen for development: the owner sets the real prices here and in
 * Stripe before launch (docs/PAYMENTS.md, "What the owner must do").
 */
export const PRODUCTS: readonly Product[] = [
  levelProduct('A2', 1490),
  levelProduct('B1', 1490),
  levelProduct('B2', 1490),
  levelProduct('C1', 1490),
  levelProduct('C2', 1490),
  {
    sku: 'pass-year',
    kind: 'pass',
    name: 'All levels for a year',
    description: 'Every level from A2 to C2, including levels released during the year. One payment, no automatic renewal.',
    levels: PAID_LEVELS,
    days: 365,
    price: { amount: 3900, currency: 'CHF' },
  },
  {
    sku: 'book-1',
    kind: 'book',
    name: 'Book 1 "Doppelpunkt 1: Ankommen"',
    description: 'The access code printed in the book unlocks A2. No expiry.',
    levels: ['A2'],
  },
];

/** Book access codes: the 2-character tag at the start of a code names the book. */
export const BOOKS: Readonly<Record<string, Sku>> = { B1: 'book-1' };

export function productFor(sku: string): Product | undefined {
  return PRODUCTS.find((p) => p.sku === sku);
}

/** Products sold through Stripe Checkout (they have a price). */
export const SOLD_PRODUCTS: readonly Product[] = PRODUCTS.filter((p) => p.price);

export const isPaidLevel = (level: string): level is PaidLevel => (PAID_LEVELS as readonly string[]).includes(level);

/** "CHF 14.90" (or the locale's format when Intl is available). */
export function formatPrice(price: Price, locale = 'en-CH'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency }).format(price.amount / 100);
  } catch {
    return `${price.currency} ${(price.amount / 100).toFixed(2)}`;
  }
}
