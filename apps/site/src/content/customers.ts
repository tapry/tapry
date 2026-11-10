// Customer stories. Only real, approved stories go here: each one is a person who agreed to be
// quoted, with numbers they gave us. While the list is empty the Customers page isn't built,
// and every link and section that would point to it (nav, footer, the landing's stories,
// the use-case quote cards) stays hidden.
import type { ArticleBlock } from "./blog";

export type CustomerStory = {
  slug: string;
  org: string;
  /** Filter on the Customers page, e.g. "Podcast", "Research", "Newsroom", "Privacy". */
  tag: string;
  name: string;
  role: string;
  /** A photo of the person, with their permission (public/...). */
  photo: string;
  quote: string;
  /** Two short figures for the cards: [value, what it counts]. */
  stats: Array<[string, string]>;
  /** Shown large at the top of the Customers page. */
  featured?: { quote: string };
  /** Which use case it belongs to (use-cases page section id), for that section's quote card. */
  useCase?: "podcasts" | "research" | "newsrooms" | "privacy";
  story: { title: string; lede: string; stats: Array<[string, string]>; blocks: ArticleBlock[] };
};

export const customers: CustomerStory[] = [];

export const hasCustomers = customers.length > 0;
