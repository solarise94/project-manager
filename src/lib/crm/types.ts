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
  assignmentStatus: string;
  assignedAt: string | null;
  assignedByUserId: string | null;
  assignedByUser: { id: string; name: string } | null;
  recalledAt: string | null;
  recalledByUserId: string | null;
  recalledByUser: { id: string; name: string } | null;
  reflowReason: string | null;
  personCategory: string | null;
  jobTitle: string | null;
  graduationDate: string | null;
  graduationStatus?: string | null;
  graduationReminderAt: string | null;
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
    organizationId: string | null;
    organizationSiteId: string | null;
    labOrGroup: string | null;
    orgSite?: { id: string; siteName: string; siteType: string } | null;
  };
  ownerUser: { id: string; name: string };
  _count?: {
    interactions: number;
    followUpTasks: number;
    visitCheckins: number;
    addresses: number;
  };
  validOrderCount?: number;
  isRepeatCustomer?: boolean;
  dormantRisk?: boolean;
  nextCommunicationTaskAt?: string | null;
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
  orderedCustomerCount: number;
  repeatCustomerCount: number;
  repeatCustomerRate: number;
  dormantCustomerCount: number;
  dormantWarningCustomerCount: number;
  communicatedCustomerCount30d: number;
  communicationCoverageRate30d: number;
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
  fromHasCrm?: boolean;
  toHasCrm?: boolean;
}

export interface CrmRegionManagerItem {
  id: string;
  userId: string;
  user: { id: string; name: string; email: string };
  regionId: string | null;
  region: { id: string; name: string } | null;
  archived: boolean;
  createdAt: string;
  reps: { id: string; representativeId: string; representative: { id: string; name: string; email: string } }[];
}

export interface CrmRepresentativeOpsItem {
  representativeId: string;
  name: string;
  email: string;
  archived: boolean;
  userId: string | null;
  userName: string | null;
  customerCount: number;
  visitCheckinCount: number;
  interactionCount30d?: number;
  lastCheckinAt: string | null;
  overdueFollowUps: number;
  longUnvisitedCount: number;
  dueCommunicationTaskCount?: number;
  doneCommunicationTaskCount?: number;
  overdueCommunicationTaskCount?: number;
  communicatedCustomerCount30d?: number;
  communicationCoverageRate30d?: number;
  orderedCustomerCount30d?: number;
  repeatCustomerCount30d?: number;
  repeatCustomerRate30d?: number;
  orderedCustomerCount90d?: number;
  repeatCustomerCount90d?: number;
  repeatCustomerRate90d?: number;
  activeCustomerCount?: number;
  newCustomerCount30d?: number;
  convertedCustomerCount30d?: number;
  conversionRate30d?: number;
  newCustomerCount90d?: number;
  convertedCustomerCount90d?: number;
  conversionRate90d?: number;
  dormantCustomerCount?: number;
  dormantWarningCustomerCount?: number;
  periodVisitCheckinCount?: number;
  periodInteractionCount?: number;
  periodNewCustomerCount?: number;
  periodReservedOrderCount?: number;
  periodReservedOrderAmount?: number;
  regions?: { id: string; name: string; isPrimary: boolean }[];
}

export interface CrmRepresentativeDetail {
  representative: { id: string; name: string; email: string; archived: boolean };
  linkedUser: { id: string; name: string } | null;
  customerCount: number;
  visitCheckinCount: number;
  lastCheckinAt: string | null;
  overdueFollowUps: number;
  longUnvisitedCount: number;
  dueCommunicationTaskCount?: number;
  doneCommunicationTaskCount?: number;
  overdueCommunicationTaskCount?: number;
  communicatedCustomerCount30d?: number;
  communicationCoverageRate30d?: number;
  orderedCustomerCount30d?: number;
  repeatCustomerCount30d?: number;
  repeatCustomerRate30d?: number;
  orderedCustomerCount90d?: number;
  repeatCustomerCount90d?: number;
  repeatCustomerRate90d?: number;
  activeCustomerCount?: number;
  newCustomerCount30d?: number;
  convertedCustomerCount30d?: number;
  conversionRate30d?: number;
  newCustomerCount90d?: number;
  convertedCustomerCount90d?: number;
  conversionRate90d?: number;
  dormantCustomerCount?: number;
  dormantWarningCustomerCount?: number;
  customers: CrmCustomerProfileItem[];
  recentCheckins: CrmVisitCheckinItem[];
  openFollowUps: CrmFollowUpTaskItem[];
  relationCount: number;
  regions: { id: string; name: string; isPrimary: boolean }[];
}

export interface CrmAssignmentLogItem {
  id: string;
  profileId: string;
  fromOwnerUserId: string | null;
  fromOwnerUser: { id: string; name: string } | null;
  toOwnerUserId: string | null;
  toOwnerUser: { id: string; name: string } | null;
  action: string;
  reason: string | null;
  createdByUserId: string;
  createdByUser: { id: string; name: string };
  createdAt: string;
}

export interface CrmReportCustomerItem {
  customerId: string;
  customerName: string;
  customerCode: string;
  organization: string | null;
  stage: string;
  importance: string;
  personCategory: string | null;
  jobTitle: string | null;
  graduationStatus: string | null;
  weeklyVisitCount: number;
  lastVisitAt: string | null;
  latestDemand: string | null;
  latestInteractionAt: string | null;
  nextFollowUpAt: string | null;
  hasOrderThisWeek: boolean;
  validOrderCount?: number;
  lastOrderAt?: string | null;
  isRepeatCustomer?: boolean;
  dormantRisk?: boolean;
  nextCommunicationTaskAt?: string | null;
}

export interface CrmReportLineItem {
  id: string;
  customerId: string;
  customerName: string;
  customerCode?: string;
  organization: string | null;
  demand: string;
  note: string;
  sortOrder: number;
  customerExists?: boolean;
  stage?: string;
  importance?: string;
  weeklyVisitCount?: number;
  lastVisitAt?: string | null;
  hasOrderThisWeek?: boolean;
}

export interface CrmRepresentativeReport {
  representative: { id: string; name: string; email: string };
  periodStart: string;
  periodEnd: string;
  summary: {
    visitCheckinCount: number;
    newCustomerCount: number;
    reservedOrderCount: number;
    reservedOrderAmount: number;
    communicatedCustomerCount: number;
    dueCommunicationTaskCount?: number;
    doneCommunicationTaskCount?: number;
  };
  customers: CrmReportCustomerItem[];
  lines: CrmReportLineItem[];
  draftNote: string | null;
}

export interface CrmLifecycleSummary {
  customerId: string;
  profileId: string;
  validOrderCount: number;
  validOrderAmount: number;
  lastOrderAt: string | null;
  isRepeatCustomer: boolean;
  lastEffectiveInteractionAt: string | null;
  nextCommunicationTaskAt: string | null;
  openCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  dormantRisk: boolean;
}
