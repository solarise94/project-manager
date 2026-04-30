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

// Higher score = more relevant POI
const POI_CATEGORY_PRIORITY: Record<string, number> = {
  "学校": 100, "大学": 100, "学院": 100,
  "医院": 90, "医疗": 90,
  "火车站": 80, "地铁站": 80, "汽车站": 80,
  "园区": 70, "产业园区": 70, "开发区": 70,
  "景点": 60, "公园": 60, "景区": 60, "旅游景点": 60,
  "政府": 50, "行政机关": 50,
};

function poiPriority(poi: PoiItem): number {
  const searchStr = `${poi.name} ${poi.category}`;
  for (const [key, score] of Object.entries(POI_CATEGORY_PRIORITY)) {
    if (searchStr.includes(key)) return score;
  }
  return 0;
}

function sortPois(pois: PoiItem[]): PoiItem[] {
  return [...pois].sort((a, b) => poiPriority(b) - poiPriority(a));
}

async function fetchGeocode(lat: number, lng: number, key: string, radius: number, policy: number): Promise<{ error?: string; status?: number; result?: GeocodeResult }> {
  const params = new URLSearchParams();
  params.set("location", `${lat},${lng}`);
  params.set("key", key);
  params.set("get_poi", "1");
  params.set("poi_options", `address_format=short;radius=${radius};policy=${policy}`);
  const url = `https://apis.map.qq.com/ws/geocoder/v1/?${params.toString()}`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch {
    return { error: "Geocode request failed" };
  }

  const status = data.status as number;
  if (status === 120) return { error: "地图请求过快，请稍后重试", status: 120 };
  if (status === 110 || status === 111) return { error: "地图 Key 未配置或无效", status };
  if (status !== 0 || !data.result) return { error: `Geocode error: status=${status}`, status };

  const r = data.result as Record<string, unknown>;
  const comp = (r.address_component || r.address_components || {}) as Record<string, unknown>;

  const pois: PoiItem[] = ((r.pois as Array<Record<string, unknown>>) || []).map((p) => ({
    name: (p.title as string) || "",
    address: (p.address as string) || "",
    distance: (p._distance as number) || 0,
    category: (p.category as string) || "",
  }));

  return {
    result: {
      address: (r.address as string) || "",
      formattedAddress: (r.formatted_addresses as Record<string, string> | undefined)?.recommend || null,
      province: (comp.province as string) || null,
      city: (comp.city as string) || null,
      district: (comp.district as string) || null,
      pois: sortPois(pois).slice(0, 5),
      raw: JSON.stringify(data),
    },
  };
}

const HIGH_PRIORITY_THRESHOLD = 60;

function hasHighPriorityPoi(pois: PoiItem[]): boolean {
  return pois.some((p) => poiPriority(p) >= HIGH_PRIORITY_THRESHOLD);
}

export async function reverseGeocode(lat: number, lng: number): Promise<{ error?: string; status?: number; result?: GeocodeResult }> {
  const key = process.env.TENCENT_MAP_KEY;
  if (!key) return { error: "地图 Key 未配置" };

  // First round: narrow radius (500m) with policy=4
  const first = await fetchGeocode(lat, lng, key, 500, 4);
  if (first.error) {
    if (first.status === 110 || first.status === 111) return first;
    return first;
  }

  const firstPois = first.result?.pois ?? [];
  const hasHighPriority = hasHighPriorityPoi(firstPois);

  // If first round has both a recommend address and high-priority POIs, we're done
  if (first.result?.formattedAddress && hasHighPriority) return first;

  // Otherwise, try wider radius to find landmarks
  const second = await fetchGeocode(lat, lng, key, 5000, 5);
  if (second.error || !second.result) return first;

  // Merge results: keep first round's address, merge and deduplicate POIs
  const seenNames = new Set(firstPois.map((p) => p.name));
  const mergedPois = [...firstPois];
  for (const p of second.result.pois) {
    if (!seenNames.has(p.name)) {
      seenNames.add(p.name);
      mergedPois.push(p);
    }
  }

  return {
    result: {
      ...second.result,
      formattedAddress: first.result?.formattedAddress || second.result.formattedAddress,
      pois: sortPois(mergedPois).slice(0, 5),
    },
  };
}
