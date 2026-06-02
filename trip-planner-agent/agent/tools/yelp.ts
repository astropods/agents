export async function searchYelp(
  term: string,
  location: string,
  limit: number,
): Promise<unknown> {
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
  return res.json();
}
