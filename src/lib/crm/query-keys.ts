export const crmKeys = {
  dashboard: () => ["crm-dashboard"] as const,
  profiles: () => ["crm-profiles"] as const,
  profileByCustomer: (sourceCustomerId: string) => ["crm-profile-by-customer", sourceCustomerId] as const,
  followUps: () => ["crm-follow-ups"] as const,
  relations: (customerId: string) => ["crm-relations", customerId] as const,
  relationsAll: () => ["crm-relations-all"] as const,
  customersForCrm: () => ["customers-for-crm"] as const,
  assignees: () => ["crm-assignees"] as const,
  customers: () => ["customers"] as const,
  customersList: () => ["customers-list"] as const,
  customerApplications: () => ["crm-customer-applications"] as const,
};
