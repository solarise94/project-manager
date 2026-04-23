export interface NotificationPrefs {
  emailOnReminder: boolean;
  emailOnStatusChange: boolean;
  emailOnTicketReply: boolean;
  emailOnComment: boolean;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string | null | undefined;
  orderNumber?: string | null | undefined;
  organization?: string | null | undefined;
  client?: string | null | undefined;
  representative?: string | null | undefined;
  status: string;
  progress: number;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  archived: boolean;
  deleted: boolean;
  deletedAt?: string | null;
  deletedReason?: string | null;
  members?: Array<{
    user: { id: string; name: string; email: string; avatar?: string | null };
    role: string;
  }>;
  _count?: { tickets: number; comments: number; attachments?: number };
}

export interface TicketItem {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  reminderDate?: string | null;
  reminderSent: boolean;
  projectId: string;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string; avatar?: string | null } | null;
  assigneeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineItem {
  id: string;
  type: string;
  content: string;
  metadata: string | null;
  createdAt: string;
  user: { id: string; name: string; avatar?: string | null } | null;
  kind: "activity" | "comment" | "attachment" | "status";
}

export interface TicketReplyItem {
  id: string;
  content: string;
  ticketId: string;
  author: { id: string; name: string; avatar?: string | null };
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalProjects: number;
  inProgressProjects: number;
  completedProjects: number;
  pendingTickets: number;
  weekProjects: number;
  weekTickets: number;
  statusDistribution: Array<{ status: string; _count: { status: number } }>;
  ticketTrend: Array<{ date: string; count: number }>;
}
