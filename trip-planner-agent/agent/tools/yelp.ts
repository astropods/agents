interface YelpBusiness {
  name: string;
  is_closed: boolean;
  review_count: number;
  rating: number;
  categories: { title: string; alias: string }[];
  location: unknown;
  hours?: unknown[];
  [key: string]: unknown;
}

export async function searchYelp(
  term: string,
  location: string,
  limit: number,
): Promise<{ businesses: object[] }> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) throw new Error("YELP_API_KEY not set");

  const url =
    `https://api.yelp.com/v3/businesses/search` +
    `?term=${encodeURIComponent(term)}` +
    `&location=${encodeURIComponent(location)}` +
    `&limit=${limit}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Yelp API error: ${res.status}`);
  const data = (await res.json()) as { businesses: YelpBusiness[] };

  return {
    businesses: data.businesses.map((b) => ({
      name: b.name,
      is_closed: b.is_closed,
      review_count: b.review_count,
      rating: b.rating,
      categories: b.categories.map((c) => c.title),
      location: b.location,
      hours: b.hours,
    })),
  };
}
