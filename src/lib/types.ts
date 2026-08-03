export type Role = "flow-ops" | "tcm" | "hr" | "owner" | "admin";
export type Intent = "hot" | "warm" | "cold";
export type TourStatus = "scheduled" | "completed" | "no-show" | "cancelled";
export type ClientDecision = "booked" | "thinking" | "dropped" | null;
export type LeadStage =
  | "new"
  | "contacted"
  | "tour-scheduled"
  | "tour-done"
  | "negotiation"
  | "booked"
  | "dropped";

export interface TCM {
  id: string;
  name: string;
  initials: string;
  zone: string;
  conversionRate: number; // 0-1
  avgResponseMins: number;
  /** Direct dial / WhatsApp number (E.164 or 10-digit IN). */
  phone?: string;
  /** Work email — used for Calendly guest invites and notifications. */
  email?: string;
  /** Personal Calendly link — used by "Schedule a tour". */
  calendly?: string;
  /** Areas this TCM covers — used by the routing engine to auto-assign. */
  areas?: string[];
}

export interface Property {
  id: string;
  name: string;
  area: string;
  totalBeds: number;
  vacantBeds: number;
  daysSinceLastBooking: number;
  pricePerBed: number;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  source: string;
  budget: number;
  moveInDate: string;
  preferredArea: string;
  assignedTcmId: string;
  stage: LeadStage;
  intent: Intent;
  confidence: number; // 0-100 (deal probability)
  tags: string[];
  nextFollowUpAt: string | null;
  responseSpeedMins: number; // first response time
  createdAt: string;
  updatedAt: string;
}

export interface PostTourUpdate {
  outcome: "booked" | "thinking" | "not-interested" | null;
  confidence: number;
  objection: string | null;
  objectionNote: string;
  expectedDecisionAt: string | null;
  nextFollowUpAt: string | null;
  filledAt: string | null;
}

export interface Tour {
  id: string;
  leadId: string;
  propertyId: string;
  //Eaxct owner inventory room selected for this tour.
  // Optional so existing/old tours continue to work.
  roomId?: string;
  tcmId: string;
  scheduledAt: string;
  status: TourStatus;
  decision: ClientDecision;
  postTour: PostTourUpdate;
  createdAt: string;
  updatedAt: string;
}

export type ActivityKind =
  | "lead_created"
  | "status_changed"
  | "tour_scheduled"
  | "tour_completed"
  | "tour_cancelled"
  | "decision_logged"
  | "post_tour_filled"
  | "follow_up_set"
  | "follow_up_done"
  | "note_added"
  | "message_sent"
  | "call_logged"
  | "escalation"
  | "stale_alert";

export interface ActivityLog {
  id: string;
  ts: string;
  kind: ActivityKind;
  actor: string; // tcmId | "flow-ops" | "system"
  leadId?: string;
  tourId?: string;
  propertyId?: string;
  text: string;
}

export type FollowUpPriority = "high" | "medium" | "low";
export interface FollowUp {
  id: string;
  leadId: string;
  tourId?: string;
  tcmId: string;
  dueAt: string;
  priority: FollowUpPriority;
  reason: string;
  done: boolean;
}

/* ============== HANDOFF (FlowOps ↔ TCM messaging) ============== */
export interface HandoffMessage {
  id: string;
  leadId: string;
  ts: string;
  from: Role;
  fromId: string; // tcmId or 'flow-ops' or 'hr'
  to: Role; // implicit destination
  text: string;
  priority: "normal" | "urgent";
  read: boolean;
}

/* ============== SEQUENCE (WhatsApp state machine) ============== */
export type SequenceKind = "post-tour" | "pre-decision" | "cold-revival" | "first-contact";
export interface ActiveSequence {
  id: string;
  leadId: string;
  kind: SequenceKind;
  startedAt: string;
  currentStep: number;
  paused: boolean;
  stoppedReason?: string;
}

/* ============== BOOKING ============== */
export interface Booking {
  id: string;
  leadId: string;
  tourId: string;
  propertyId: string;
  tcmId: string;
  amount: number; // monthly rent
  ts: string;
}
