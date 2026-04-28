export async function reverseGeocode(lat: number, lng: number): Promise<{
  address: string;
  province: string | null;
  city: string | null;
  district: string | null;
  raw: string;
} | null> {
  const key = process.env.TENCENT_MAP_KEY;
  if (!key) return null;

  try {
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 0 || !data.result) return null;

    const r = data.result;
    return {
      address: r.address || "",
      province: r.address_component?.province || null,
      city: r.address_component?.city || null,
      district: r.address_component?.district || null,
      raw: JSON.stringify(data),
    };
  } catch {
    console.error("Reverse geocode failed for", lat, lng);
    return null;
  }
}
