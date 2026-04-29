export interface PoiItem {
  name: string;
  address: string;
  distance: number;
  category: string;
}

export interface GeocodeResult {
  address: string;
  formattedAddress: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  pois: PoiItem[];
  raw: string;
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  const key = process.env.TENCENT_MAP_KEY;
  if (!key) return null;

  try {
    const params = new URLSearchParams();
    params.set("location", `${lat},${lng}`);
    params.set("key", key);
    params.set("get_poi", "1");
    params.set("poi_options", "address_format=short;radius=500;policy=4");
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 0 || !data.result) return null;

    const r = data.result;
    const comp = r.address_component || r.address_components || {};

    const pois: PoiItem[] = (r.pois || []).slice(0, 5).map((p: Record<string, unknown>) => ({
      name: (p.title as string) || "",
      address: (p.address as string) || "",
      distance: (p._distance as number) || 0,
      category: (p.category as string) || "",
    }));

    return {
      address: r.address || "",
      formattedAddress: r.formatted_addresses?.recommend || null,
      province: comp.province || null,
      city: comp.city || null,
      district: comp.district || null,
      pois,
      raw: JSON.stringify(data),
    };
  } catch {
    console.error("Reverse geocode failed for", lat, lng);
    return null;
  }
}
