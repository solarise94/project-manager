export interface CrmCustomerProfileItem {
  id: string;
  sourceCustomerId: string;
  ownerUserId: string;
  stage: string;
  importance: string;
  tagsJson: string | null;
  summary: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  lastOrderAt: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  sourceCustomer: {
    id: string;
    name: string;
    customerCode: string;
    principal: string | null;
    email: string | null;
    wechat: string | null;
    organization: string | null;
    address: string | null;
  };
  ownerUser: { id: string; name: string };
  _count?: {
    interactions: number;
    followUpTasks: number;
    visitCheckins: number;
    addresses: number;
  };
}

export interface CrmInteractionItem {
  id: string;
  profileId: string;
  type: string;
  summary: string;
  detail: string | null;
  happenedAt: string;
  nextActionAt: string | null;
  relatedProjectId: string | null;
  createdByUserId: string;
  createdByUser: { id: string; name: string };
  voiceUrl: string | null;
  transcript: string | null;
  summaryTitle: string | null;
  summaryNote: string | null;
  asrStatus: string;
  createdAt: string;
}

export interface CrmFollowUpTaskItem {
  id: string;
  profileId: string;
  ownerUserId: string;
  ownerUser: { id: string; name: string };
  title: string;
  dueAt: string;
  status: string;
  completedAt: string | null;
  completedInteractionId: string | null;
  reminderSent: boolean;
  createdByUserId: string;
  createdByUser: { id: string; name: string };
  createdAt: string;
  profile?: {
    id: string;
    sourceCustomerId: string;
    sourceCustomer: { id: string; name: string; customerCode: string };
  };
}

export interface CrmVisitCheckinItem {
  id: string;
  profileId: string;
  interactionId: string | null;
  userId: string;
  user: { id: string; name: string };
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  addressSnapshot: string | null;
  mapProvider: string | null;
  photoCount: number;
  status: string;
  voiceUrl: string | null;
  transcript: string | null;
  summaryTitle: string | null;
  summary: string | null;
  asrStatus: string;
  completedAt: string | null;
  createdAt: string;
  media: CrmVisitMediaItem[];
}

export interface CrmVisitMediaItem {
  id: string;
  checkinId: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface CrmCustomerAddressItem {
  id: string;
  profileId: string;
  label: string;
  addressText: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  sourceType: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  createdAt: string;
}

export interface CrmDashboardStats {
  totalProfiles: number;
  myProfiles: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
  thisWeekCheckins: number;
  stageDistribution: Array<{ stage: string; _count: number }>;
  recentInteractions: CrmInteractionItem[];
}

export interface CrmRelationItem {
  id: string;
  fromCustomerId: string;
  fromCustomer: { id: string; name: string; customerCode: string; organization?: string | null };
  toCustomerId: string;
  toCustomer: { id: string; name: string; customerCode: string; organization?: string | null };
  type: string;
  strength: string | null;
  notes: string | null;
  introducedAt: string | null;
  createdByUserId: string;
  createdByUser: { id: string; name: string };
  createdAt: string;
}
