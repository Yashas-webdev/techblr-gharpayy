import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useCRM10x } from "@/lib/crm10x/store";
import {
  computeBookingProbability,
  inferBestCallTime,
} from "@/lib/crm10x/intelligence";
import { useCalendar } from "@/lib/calendar-store";

import type { Lead } from "@/lib/types";
import type { CallOutcome, LangPref } from "@/lib/crm10x/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Phone,
  Sparkles,
  Trophy,
  Clock,
  CalendarClock,
  Lightbulb,
  CalendarDays,
  MessageCircle,
  AlertCircle,
  CheckCircle2,
  HeartPulse,
  ShieldCheck,
  TriangleAlert,
  Activity,
} from "lucide-react";

import { toast } from "sonner";

import { ObjectionLogger } from "./ObjectionLogger";
import { LeadDeepProfile } from "./LeadDeepProfile";
import { SmartWaLayer } from "./SmartWaLayer";
import { QuotationBuilder } from "./QuotationBuilder";
import { ContactOutcomeChips } from "./ContactOutcomeChips";

/* ============================================================
   DATE HELPERS
   ============================================================ */

function getTodayDate() {
  const d = new Date();

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTomorrowDate() {
  const d = new Date();

  d.setDate(d.getDate() + 1);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* ============================================================
   SMART FOLLOW-UP
   ============================================================ */

function getSuggestedFollowUp(
  outcome: CallOutcome,
): {
  date: string;
  time: string;
  reason: string;
} | null {
  const now = new Date();

  if (outcome === "not-answered") {
    return {
      date: getTomorrowDate(),
      time: "10:00",
      reason: "Lead did not answer. Try again tomorrow morning.",
    };
  }

  if (outcome === "busy") {
    const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const date = [
      later.getFullYear(),
      String(later.getMonth() + 1).padStart(2, "0"),
      String(later.getDate()).padStart(2, "0"),
    ].join("-");

    const time = `${String(later.getHours()).padStart(2, "0")}:${String(
      later.getMinutes(),
    ).padStart(2, "0")}`;

    return {
      date,
      time,
      reason: "Lead was busy. Follow up again after 2 hours.",
    };
  }

  if (outcome === "switched-off") {
    return {
      date: getTomorrowDate(),
      time: "11:00",
      reason: "Phone was switched off. Try again tomorrow.",
    };
  }

  if (outcome === "callback-requested") {
    return {
      date: getTodayDate(),
      time: "",
      reason: "Customer requested a callback.",
    };
  }

  return null;
}

function shouldSuggestFollowUp(outcome: CallOutcome) {
  return [
    "not-answered",
    "busy",
    "switched-off",
    "callback-requested",
  ].includes(outcome);
}

/* ============================================================
   SMART NEXT ACTION
   ============================================================ */

type NextActionType =
  | "call"
  | "schedule-tour"
  | "follow-up"
  | "verify-number"
  | "quotation"
  | "close";

interface SmartNextAction {
  type: NextActionType;
  title: string;
  description: string;
  reasons: string[];
  priority: "high" | "medium" | "low";
}

function getSmartNextAction({
  calls,
  tours,
  probability,
  bestTime,
}: {
  calls: any[];
  tours: any[];
  probability: number;
  bestTime: string;
}): SmartNextAction {
  const latestCall =
    calls.length > 0 ? calls[calls.length - 1] : undefined;

  const hasScheduledTour = tours.some(
    (tour) =>
      tour.status === "scheduled" ||
      tour.status === "confirmed",
  );

  const hasCompletedTour = tours.some(
    (tour) => tour.status === "completed",
  );

  if (latestCall?.outcome === "wrong-number") {
    return {
      type: "verify-number",
      title: "Verify contact number",
      description:
        "The last call was marked as a wrong number. Verify the lead's contact details before taking another action.",
      reasons: [
        "Previous call outcome was Wrong number",
        "Further calls may be wasted until the number is corrected",
      ],
      priority: "high",
    };
  }

  if (latestCall?.outcome === "callback-requested") {
    return {
      type: "follow-up",
      title: "Follow up with the lead",
      description:
        bestTime !== "—"
          ? `The customer requested a callback. Contact them during their preferred time: ${bestTime}.`
          : "The customer requested a callback. Follow up at the scheduled time.",
      reasons: [
        "Customer explicitly requested another call",
        bestTime !== "—"
          ? `Preferred call time is ${bestTime}`
          : "Use the scheduled follow-up time",
      ],
      priority: "high",
    };
  }

  if (latestCall?.outcome === "busy") {
    return {
      type: "call",
      title: "Call the lead again",
      description:
        bestTime !== "—"
          ? `The previous call was busy. Try again during ${bestTime}.`
          : "The previous call was busy. Try contacting the lead again later.",
      reasons: [
        "Previous call outcome was Busy",
        bestTime !== "—"
          ? `Best call time recorded as ${bestTime}`
          : "Lead has not completed the conversation yet",
      ],
      priority: "high",
    };
  }

  if (
    latestCall?.outcome === "not-answered" ||
    latestCall?.outcome === "switched-off"
  ) {
    return {
      type: "follow-up",
      title: "Retry contact",
      description:
        bestTime !== "—"
          ? `The lead could not be reached. Try again during ${bestTime}.`
          : "The lead could not be reached. Schedule another contact attempt.",
      reasons: [
        latestCall.outcome === "not-answered"
          ? "Previous call was not answered"
          : "Phone was switched off",
        `Contact attempts: ${calls.length}`,
      ],
      priority: calls.length >= 3 ? "medium" : "high",
    };
  }

  if (hasCompletedTour) {
    return {
      type: "quotation",
      title: "Move toward booking",
      description:
        "The property visit has been completed. Follow up on the lead's decision and move toward quotation or booking.",
      reasons: [
        "Property tour has been completed",
        `Current booking probability is ${probability}%`,
      ],
      priority: probability >= 60 ? "high" : "medium",
    };
  }

  if (hasScheduledTour) {
    return {
      type: "follow-up",
      title: "Reconfirm scheduled tour",
      description:
        "A property tour is already scheduled. Reconfirm the visit with the lead before the scheduled time.",
      reasons: [
        "Lead already has an upcoming tour",
        "Reconfirmation can reduce no-shows",
      ],
      priority: "medium",
    };
  }

  if (
    latestCall?.outcome === "answered" &&
    probability >= 50
  ) {
    return {
      type: "schedule-tour",
      title: "Schedule a property tour",
      description:
        "The lead has been contacted successfully and shows good booking potential. Move them to a property visit.",
      reasons: [
        "Previous call was answered",
        `Booking probability is ${probability}%`,
        "No active tour is currently scheduled",
      ],
      priority: probability >= 75 ? "high" : "medium",
    };
  }

  if (calls.length === 0) {
    return {
      type: "call",
      title: "Make first contact",
      description:
        bestTime !== "—"
          ? `This lead has not been contacted yet. Call during ${bestTime}.`
          : "This lead has not been contacted yet. Make the first contact and understand their requirements.",
      reasons: [
        "No call attempts recorded",
        "Lead qualification has not started",
      ],
      priority: "high",
    };
  }

  return {
    type: "follow-up",
    title: "Continue lead follow-up",
    description:
      "Continue nurturing this lead and determine the next step based on their latest response.",
    reasons: [
      `Booking probability is ${probability}%`,
      `Total call attempts: ${calls.length}`,
    ],
    priority: "medium",
  };
}

/* ============================================================
   LEAD HEALTH / NEGLECT RISK
   ============================================================ */

type LeadHealthLevel =
  | "healthy"
  | "watch"
  | "attention"
  | "critical";

interface LeadHealthResult {
  riskScore: number;
  healthScore: number;
  level: LeadHealthLevel;
  label: string;
  message: string;
  reasons: {
    label: string;
    points: number;
  }[];
}

function calculateLeadHealth({
  calls,
  tours,
  visits,
  probability,
}: {
  calls: any[];
  tours: any[];
  visits: any[];
  probability: number;
}): LeadHealthResult {
  let riskScore = 0;

  const reasons: {
    label: string;
    points: number;
  }[] = [];

  const answeredCalls = calls.filter(
    (call) => call.outcome === "answered",
  );

  const unsuccessfulCalls = calls.filter((call) =>
    [
      "not-answered",
      "busy",
      "switched-off",
    ].includes(call.outcome),
  );

  const wrongNumberCalls = calls.filter(
    (call) => call.outcome === "wrong-number",
  );

  const callbackRequests = calls.filter(
    (call) => call.outcome === "callback-requested",
  );

  const hasScheduledTour = tours.some(
    (tour) =>
      tour.status === "scheduled" ||
      tour.status === "confirmed",
  );

  const hasCompletedTour = tours.some(
    (tour) => tour.status === "completed",
  );

  /*
   * No successful conversation yet.
   */
  if (calls.length > 0 && answeredCalls.length === 0) {
    riskScore += 25;

    reasons.push({
      label: "No successful call recorded yet",
      points: 25,
    });
  }

  /*
   * Brand-new lead that has not been contacted.
   */
  if (calls.length === 0) {
    riskScore += 20;

    reasons.push({
      label: "Lead has not been contacted yet",
      points: 20,
    });
  }

  /*
   * Repeated failed contact attempts.
   */
  if (unsuccessfulCalls.length >= 3) {
    riskScore += 20;

    reasons.push({
      label: `${unsuccessfulCalls.length} unsuccessful contact attempts`,
      points: 20,
    });
  } else if (unsuccessfulCalls.length === 2) {
    riskScore += 12;

    reasons.push({
      label: "2 unsuccessful contact attempts",
      points: 12,
    });
  } else if (unsuccessfulCalls.length === 1) {
    riskScore += 5;

    reasons.push({
      label: "1 unsuccessful contact attempt",
      points: 5,
    });
  }

  /*
   * Wrong number is a major risk.
   */
  if (wrongNumberCalls.length > 0) {
    riskScore += 30;

    reasons.push({
      label: "Contact number may be invalid",
      points: 30,
    });
  }

  /*
   * Customer requested callback but conversation
   * has not progressed to a tour.
   */
  if (
    callbackRequests.length > 0 &&
    !hasScheduledTour &&
    !hasCompletedTour
  ) {
    riskScore += 10;

    reasons.push({
      label: "Callback requested but lead has not progressed to a tour",
      points: 10,
    });
  }

  /*
   * Multiple calls but no tour.
   */
  if (
    calls.length >= 2 &&
    !hasScheduledTour &&
    !hasCompletedTour
  ) {
    riskScore += 15;

    reasons.push({
      label: "Multiple calls but no property tour scheduled",
      points: 15,
    });
  }

  /*
   * Low booking probability.
   */
  if (probability < 30) {
    riskScore += 15;

    reasons.push({
      label: `Low booking probability (${probability}%)`,
      points: 15,
    });
  } else if (probability < 50) {
    riskScore += 8;

    reasons.push({
      label: `Booking probability needs improvement (${probability}%)`,
      points: 8,
    });
  }

  /*
   * Positive signals reduce neglect risk.
   */
  if (answeredCalls.length > 0) {
    riskScore -= 10;
  }

  if (hasScheduledTour) {
    riskScore -= 15;
  }

  if (hasCompletedTour) {
    riskScore -= 25;
  }

  if (visits.length > 0) {
    riskScore -= 5;
  }

  if (probability >= 75) {
    riskScore -= 10;
  }

  /*
   * Always keep score between 0 and 100.
   */
  riskScore = Math.max(
    0,
    Math.min(100, riskScore),
  );

  const healthScore = 100 - riskScore;

  let level: LeadHealthLevel;
  let label: string;
  let message: string;

  if (riskScore >= 80) {
    level = "critical";
    label = "Critical";

    message =
      "This lead is at high risk of being lost. Immediate attention is recommended.";
  } else if (riskScore >= 60) {
    level = "attention";
    label = "Needs Attention";

    message =
      "This lead is showing signs of neglect or stalled progress. Take action soon.";
  } else if (riskScore >= 30) {
    level = "watch";
    label = "Watch";

    message =
      "The lead is progressing, but there are some risk signals worth monitoring.";
  } else {
    level = "healthy";
    label = "Healthy";

    message =
      "This lead is currently being managed well with no major neglect signals.";
  }

  return {
    riskScore,
    healthScore,
    level,
    label,
    message,
    reasons,
  };
}

/* ============================================================
   COMPONENT
   ============================================================ */

export function LeadDossierPanel({
  lead,
}: {
  lead: Lead;
}) {
  /* ==========================================================
     STORES
     ========================================================== */

  const allTours = useApp((s) => s.tours);

  const profile = useCRM10x(
    (s) => s.profiles[lead.id],
  );

  const allObjections = useCRM10x(
    (s) => s.objections,
  );

  const allCalls = useCRM10x(
    (s) => s.calls,
  );

  const visitsRecord = useCRM10x(
    (s) => s.visits,
  );

  const logCall = useCRM10x(
    (s) => s.logCall,
  );

  const addCalendarEvent = useCalendar(
    (s) => s.addEvent,
  );

  /* ==========================================================
     CURRENT LEAD DATA
     ========================================================== */

  const tours = useMemo(
    () =>
      allTours.filter(
        (t) => t.leadId === lead.id,
      ),
    [allTours, lead.id],
  );

  const objections = useMemo(
    () =>
      allObjections.filter(
        (o) => o.leadId === lead.id,
      ),
    [allObjections, lead.id],
  );

  const calls = useMemo(
    () =>
      allCalls.filter(
        (c) => c.leadId === lead.id,
      ),
    [allCalls, lead.id],
  );

  const visits = useMemo(
    () =>
      Object.values(visitsRecord).filter(
        (v) => v.leadId === lead.id,
      ),
    [visitsRecord, lead.id],
  );

  /* ==========================================================
     BOOKING PROBABILITY
     ========================================================== */

  const probability = useMemo(
    () =>
      computeBookingProbability({
        lead,
        profile,
        tours,
        visits,
        objections,
        calls,
      }),
    [
      lead,
      profile,
      tours,
      visits,
      objections,
      calls,
    ],
  );

  /* ==========================================================
     BEST CALL TIME
     ========================================================== */

  const bestTime = useMemo(() => {
    const latestCallWithBestTime =
      calls.find(
        (call) => call.bestCallTime,
      );

    return (
      latestCallWithBestTime?.bestCallTime ??
      profile?.bestCallTime ??
      inferBestCallTime(calls) ??
      "—"
    );
  }, [calls, profile?.bestCallTime]);

  /* ==========================================================
     SMART NEXT ACTION
     ========================================================== */

  const smartNextAction = useMemo(
    () =>
      getSmartNextAction({
        calls,
        tours,
        probability: probability.score,
        bestTime,
      }),
    [
      calls,
      tours,
      probability.score,
      bestTime,
    ],
  );

  /* ==========================================================
     LEAD HEALTH
     ========================================================== */

  const leadHealth = useMemo(
    () =>
      calculateLeadHealth({
        calls,
        tours,
        visits,
        probability: probability.score,
      }),
    [
      calls,
      tours,
      visits,
      probability.score,
    ],
  );

  /* ==========================================================
     CALL FORM
     ========================================================== */

  const [duration, setDuration] =
    useState(60);

  const [outcome, setOutcome] =
    useState<CallOutcome>("answered");

  const [language, setLanguage] =
    useState<LangPref | "">("");

  const [
    bestCallTime,
    setBestCallTime,
  ] = useState("");

  const [
    customHour,
    setCustomHour,
  ] = useState("06");

  const [
    customMinute,
    setCustomMinute,
  ] = useState("00");

  const [
    customPeriod,
    setCustomPeriod,
  ] = useState<"AM" | "PM">("PM");

  const [notes, setNotes] =
    useState("");

  /* ==========================================================
     FOLLOW-UP STATE
     ========================================================== */

  const [
    scheduleFollowUp,
    setScheduleFollowUp,
  ] = useState(false);

  const [
    followUpDate,
    setFollowUpDate,
  ] = useState("");

  const [
    followUpTime,
    setFollowUpTime,
  ] = useState("");

  const [
    followUpReason,
    setFollowUpReason,
  ] = useState("");

  /* ==========================================================
     OUTCOME CHANGE
     ========================================================== */

  const handleOutcomeChange = (
    value: string,
  ) => {
    const newOutcome =
      value as CallOutcome;

    setOutcome(newOutcome);

    const suggestion =
      getSuggestedFollowUp(
        newOutcome,
      );

    if (suggestion) {
      setScheduleFollowUp(true);
      setFollowUpDate(suggestion.date);
      setFollowUpTime(suggestion.time);
      setFollowUpReason(suggestion.reason);
    } else {
      setScheduleFollowUp(false);
      setFollowUpDate("");
      setFollowUpTime("");
      setFollowUpReason("");
    }
  };

  /* ==========================================================
     CUSTOM TIME
     ========================================================== */

  const handleCustomTimeChange = (
    hour: string,
    minute: string,
    period: "AM" | "PM",
  ) => {
    setCustomHour(hour);
    setCustomMinute(minute);
    setCustomPeriod(period);

    setBestCallTime(
      `${hour}:${minute} ${period}`,
    );
  };

  /* ==========================================================
     SUBMIT
     ========================================================== */

  const submitCall = () => {
    if (!language) {
      toast.error(
        "Please select language",
      );
      return;
    }

    if (!bestCallTime) {
      toast.error(
        "Please select best call time",
      );
      return;
    }

    if (!duration || duration <= 0) {
      toast.error(
        "Enter a valid call duration",
      );
      return;
    }

    if (scheduleFollowUp) {
      if (!followUpDate) {
        toast.error(
          "Please select follow-up date",
        );
        return;
      }

      if (!followUpTime) {
        toast.error(
          "Please select follow-up time",
        );
        return;
      }

      if (!followUpReason.trim()) {
        toast.error(
          "Please enter follow-up reason",
        );
        return;
      }

      const followUpDateTime =
        new Date(
          `${followUpDate}T${followUpTime}:00`,
        );

      if (
        Number.isNaN(
          followUpDateTime.getTime(),
        )
      ) {
        toast.error(
          "Invalid follow-up date or time",
        );
        return;
      }

      if (
        followUpDateTime.getTime() <=
        Date.now()
      ) {
        toast.error(
          "Follow-up must be scheduled for a future time",
        );
        return;
      }
    }

    /* LOG CALL */

    logCall({
      leadId: lead.id,
      attemptNumber:
        calls.length + 1,
      durationSec: duration,
      outcome,
      language:
        language || undefined,
      bestCallTime:
        bestCallTime || undefined,
      notes,
      loggedBy:
        lead.assignedTcmId,
    });

    /* CREATE CALENDAR FOLLOW-UP */

    if (
      scheduleFollowUp &&
      followUpDate &&
      followUpTime
    ) {
      const startDate =
        new Date(
          `${followUpDate}T${followUpTime}:00`,
        );

      const endDate =
        new Date(
          startDate.getTime() +
            30 * 60 * 1000,
        );

      addCalendarEvent({
        title: `Follow-up · ${lead.name}`,

        kind: "follow-up",

        start:
          startDate.toISOString(),

        end:
          endDate.toISOString(),

        allDay: false,

        description: [
          `Lead: ${lead.name}`,
          `Phone: ${lead.phone ?? "—"}`,
          `Reason: ${followUpReason}`,
          `Previous call outcome: ${outcome}`,
          `Preferred language: ${language}`,
          `Best call time: ${bestCallTime}`,
          notes
            ? `Call notes: ${notes}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),

        leadId: lead.id,

        externalSource: "local",

        reminder: 15,
      });
    }

    if (scheduleFollowUp) {
      toast.success(
        "Call logged and follow-up scheduled",
      );
    } else {
      toast.success(
        "Call logged",
      );
    }

    setNotes("");
    setBestCallTime("");
    setLanguage("");

    setScheduleFollowUp(false);
    setFollowUpDate("");
    setFollowUpTime("");
    setFollowUpReason("");
  };

  /* ==========================================================
     COLORS
     ========================================================== */

  const tone =
    probability.score >= 75
      ? "text-success border-success/40 bg-success/10"
      : probability.score >= 50
        ? "text-accent border-accent/40 bg-accent/10"
        : probability.score >= 30
          ? "text-warning border-warning/40 bg-warning/10"
          : "text-muted-foreground border-border bg-muted/40";

  const healthTone =
    leadHealth.level === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : leadHealth.level === "attention"
        ? "border-warning/50 bg-warning/5"
        : leadHealth.level === "watch"
          ? "border-accent/40 bg-accent/5"
          : "border-success/40 bg-success/5";

  const healthText =
    leadHealth.level === "critical"
      ? "text-destructive"
      : leadHealth.level === "attention"
        ? "text-warning"
        : leadHealth.level === "watch"
          ? "text-accent"
          : "text-success";

  /* ==========================================================
     UI
     ========================================================== */

  return (
    <div className="space-y-4">

      {/* ======================================================
          BOOKING PROBABILITY
          ====================================================== */}

      <div
        className={`rounded-lg border p-3 ${tone}`}
      >
        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 text-xs font-semibold">
            <Trophy className="h-3.5 w-3.5" />
            Booking probability
          </div>

          <div className="text-2xl font-display font-bold">
            {probability.score}%
          </div>

        </div>

        <div className="mt-2 text-[11px]">
          {probability.recommendation}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">

          {probability.signals
            .slice(0, 6)
            .map((s, i) => (

              <span
                key={i}
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                  s.impact > 0
                    ? "bg-success/20 text-success"
                    : "bg-destructive/20 text-destructive"
                }`}
              >
                {s.impact > 0 ? "+" : ""}
                {s.impact} · {s.label}
              </span>

            ))}

        </div>
      </div>

      {/* ======================================================
          BEST TIME
          ====================================================== */}

      <div className="flex items-center gap-2 text-xs">

        <Clock className="h-3.5 w-3.5 text-muted-foreground" />

        <span className="text-muted-foreground">
          Best time to call:
        </span>

        <span className="font-medium">
          {bestTime}
        </span>

        <span className="text-muted-foreground">
          · Attempts: {calls.length}
        </span>

      </div>

      {/* ======================================================
          LEAD HEALTH / NEGLECT RISK
          ====================================================== */}

      <div
        className={`rounded-lg border p-3 space-y-3 ${healthTone}`}
      >

        <div className="flex items-start justify-between gap-3">

          <div className="flex items-start gap-2">

            <div className="rounded-md border border-border bg-background/60 p-1.5">

              <HeartPulse
                className={`h-4 w-4 ${healthText}`}
              />

            </div>

            <div>

              <div className="text-xs font-semibold flex items-center gap-2">

                Lead Health

                <span
                  className={`text-[9px] uppercase font-semibold ${healthText}`}
                >
                  {leadHealth.label}
                </span>

              </div>

              <p className="text-[11px] text-muted-foreground mt-1">
                {leadHealth.message}
              </p>

            </div>

          </div>

          <div className="text-right shrink-0">

            <div
              className={`text-xl font-bold ${healthText}`}
            >
              {leadHealth.healthScore}
            </div>

            <div className="text-[9px] text-muted-foreground uppercase">
              Health
            </div>

          </div>

        </div>

        {/* HEALTH BAR */}

        <div className="space-y-1">

          <div className="flex items-center justify-between text-[10px]">

            <span className="text-muted-foreground">
              Health score
            </span>

            <span className="font-medium">
              {leadHealth.healthScore}/100
            </span>

          </div>

          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">

            <div
              className={
                leadHealth.level === "critical"
                  ? "h-full bg-destructive transition-all duration-500"
                  : leadHealth.level === "attention"
                    ? "h-full bg-warning transition-all duration-500"
                    : leadHealth.level === "watch"
                      ? "h-full bg-accent transition-all duration-500"
                      : "h-full bg-success transition-all duration-500"
              }
              style={{
                width: `${leadHealth.healthScore}%`,
              }}
            />

          </div>

          <div className="flex items-center justify-between text-[9px] text-muted-foreground">

            <span>
              Neglect risk: {leadHealth.riskScore}%
            </span>

            <span>
              {leadHealth.level === "healthy"
                ? "Managed well"
                : leadHealth.level === "watch"
                  ? "Monitor"
                  : leadHealth.level === "attention"
                    ? "Action needed"
                    : "Immediate action"}
            </span>

          </div>

        </div>

        {/* RISK SIGNALS */}

        <div className="rounded-md border border-border bg-background/50 p-2">

          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">

            {leadHealth.level === "healthy" ? (
              <ShieldCheck className="h-3 w-3 text-success" />
            ) : leadHealth.level === "critical" ? (
              <TriangleAlert className="h-3 w-3 text-destructive" />
            ) : (
              <Activity className="h-3 w-3" />
            )}

            Health signals

          </div>

          {leadHealth.reasons.length === 0 ? (

            <div className="flex items-center gap-1.5 text-[11px]">

              <CheckCircle2 className="h-3 w-3 text-success shrink-0" />

              <span>
                No major neglect risks detected.
              </span>

            </div>

          ) : (

            <div className="space-y-1.5">

              {leadHealth.reasons
                .slice(0, 5)
                .map((reason, index) => (

                  <div
                    key={index}
                    className="flex items-start justify-between gap-2 text-[11px]"
                  >

                    <div className="flex items-start gap-1.5">

                      <AlertCircle className="h-3 w-3 text-warning mt-0.5 shrink-0" />

                      <span>
                        {reason.label}
                      </span>

                    </div>

                    <span className="text-[9px] text-muted-foreground shrink-0">
                      +{reason.points} risk
                    </span>

                  </div>

                ))}

            </div>

          )}

        </div>

      </div>

      {/* ======================================================
          SMART NEXT ACTION
          ====================================================== */}

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">

        <div className="flex items-start gap-2">

          <div className="rounded-md bg-primary/10 p-1.5 shrink-0">

            <Lightbulb className="h-4 w-4 text-primary" />

          </div>

          <div className="min-w-0 flex-1">

            <div className="flex items-center flex-wrap gap-2">

              <span className="text-xs font-semibold">
                Smart Next Action
              </span>

              <span
                className={`rounded-full px-2 py-0.5 text-[9px] uppercase font-semibold ${
                  smartNextAction.priority === "high"
                    ? "bg-destructive/10 text-destructive"
                    : smartNextAction.priority === "medium"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {smartNextAction.priority} priority
              </span>

            </div>

            <div className="text-sm font-semibold mt-2">
              {smartNextAction.title}
            </div>

            <p className="text-[11px] text-muted-foreground mt-1">
              {smartNextAction.description}
            </p>

          </div>

        </div>

        <div className="rounded-md border border-border bg-background/50 p-2">

          <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
            Why this action?
          </div>

          <div className="space-y-1">

            {smartNextAction.reasons.map(
              (reason, index) => (

                <div
                  key={index}
                  className="flex items-start gap-1.5 text-[11px]"
                >

                  <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />

                  <span>
                    {reason}
                  </span>

                </div>

              ),
            )}

          </div>

        </div>

        <div className="rounded-md bg-background/40 border border-border p-2">

          {smartNextAction.type === "call" && (

            <div className="flex items-center gap-2 text-[11px]">
              <Phone className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                Recommended: Call lead
              </span>
            </div>

          )}

          {smartNextAction.type === "schedule-tour" && (

            <div className="flex items-center gap-2 text-[11px]">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                Recommended: Schedule tour
              </span>
            </div>

          )}

          {smartNextAction.type === "follow-up" && (

            <div className="flex items-center gap-2 text-[11px]">
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                Recommended: Follow-up
              </span>
            </div>

          )}

          {smartNextAction.type === "verify-number" && (

            <div className="flex items-center gap-2 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              <span className="font-medium text-destructive">
                Recommended: Verify phone number
              </span>
            </div>

          )}

          {smartNextAction.type === "quotation" && (

            <div className="flex items-center gap-2 text-[11px]">
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                Recommended: Booking discussion / quotation
              </span>
            </div>

          )}

        </div>

      </div>

      <ContactOutcomeChips lead={lead} />

      <LeadDeepProfile lead={lead} />

      {/* ======================================================
          CALL LOGGER
          ====================================================== */}

      <div className="rounded-lg border border-border bg-card p-3 space-y-3">

        <div className="text-xs font-semibold flex items-center gap-2">

          <Phone className="h-3.5 w-3.5" />

          Log call (attempt #{calls.length + 1})

        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

          {/* DURATION */}

          <div>

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Duration (sec)
            </Label>

            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              value={duration}
              onChange={(e) =>
                setDuration(
                  Number(e.target.value),
                )
              }
            />

          </div>

          {/* OUTCOME */}

          <div>

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Outcome
            </Label>

            <Select
              value={outcome}
              onValueChange={
                handleOutcomeChange
              }
            >

              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>

                <SelectItem value="answered">
                  Answered
                </SelectItem>

                <SelectItem value="not-answered">
                  Not answered
                </SelectItem>

                <SelectItem value="busy">
                  Busy
                </SelectItem>

                <SelectItem value="switched-off">
                  Switched off
                </SelectItem>

                <SelectItem value="wrong-number">
                  Wrong number
                </SelectItem>

                <SelectItem value="callback-requested">
                  Callback requested
                </SelectItem>

              </SelectContent>

            </Select>

          </div>

          {/* LANGUAGE */}

          <div>

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Language *
            </Label>

            <Select
              value={language}
              onValueChange={(v) =>
                setLanguage(
                  v as LangPref,
                )
              }
            >

              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>

              <SelectContent>

                <SelectItem value="english">
                  English
                </SelectItem>

                <SelectItem value="hindi">
                  Hindi
                </SelectItem>

                <SelectItem value="kannada">
                  Kannada
                </SelectItem>

                <SelectItem value="other">
                  Other
                </SelectItem>

              </SelectContent>

            </Select>

          </div>

          {/* BEST CALL TIME */}

          <div>

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Best call time *
            </Label>

            <Select
              value={bestCallTime}
              onValueChange={
                setBestCallTime
              }
            >

              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select time" />
              </SelectTrigger>

              <SelectContent>

                <SelectItem value="8:00 AM - 11:00 AM">
                  8:00 AM - 11:00 AM
                </SelectItem>

                <SelectItem value="12:00 PM - 3:00 PM">
                  12:00 PM - 3:00 PM
                </SelectItem>

                <SelectItem value="4:00 PM - 6:00 PM">
                  4:00 PM - 6:00 PM
                </SelectItem>

                <SelectItem value="custom">
                  Custom Time
                </SelectItem>

              </SelectContent>

            </Select>

          </div>

        </div>

        {/* CUSTOM CALL TIME */}

        {bestCallTime === "custom" && (

          <div className="rounded-md border border-border bg-muted/20 p-2">

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Custom call time
            </Label>

            <div className="grid grid-cols-3 gap-2 mt-1">

              <Input
                type="number"
                min={1}
                max={12}
                value={customHour}
                onChange={(e) => {
                  let hour = Number(
                    e.target.value,
                  );

                  if (hour < 1) hour = 1;
                  if (hour > 12) hour = 12;

                  const value =
                    String(hour).padStart(
                      2,
                      "0",
                    );

                  handleCustomTimeChange(
                    value,
                    customMinute,
                    customPeriod,
                  );
                }}
                className="h-8 text-xs"
              />

              <Input
                type="number"
                min={0}
                max={59}
                value={customMinute}
                onChange={(e) => {
                  let minute = Number(
                    e.target.value,
                  );

                  if (minute < 0) minute = 0;
                  if (minute > 59) minute = 59;

                  const value =
                    String(minute).padStart(
                      2,
                      "0",
                    );

                  handleCustomTimeChange(
                    customHour,
                    value,
                    customPeriod,
                  );
                }}
                className="h-8 text-xs"
              />

              <Select
                value={customPeriod}
                onValueChange={(v) => {
                  const period =
                    v as "AM" | "PM";

                  handleCustomTimeChange(
                    customHour,
                    customMinute,
                    period,
                  );
                }}
              >

                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="AM">
                    AM
                  </SelectItem>

                  <SelectItem value="PM">
                    PM
                  </SelectItem>

                </SelectContent>

              </Select>

            </div>

          </div>

        )}

        {/* NOTES */}

        <Textarea
          rows={2}
          className="text-xs resize-none"
          placeholder="Call notes…"
          value={notes}
          onChange={(e) =>
            setNotes(e.target.value)
          }
        />

        {/* ====================================================
            SMART FOLLOW-UP
            ==================================================== */}

        {shouldSuggestFollowUp(outcome) && (

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">

            <div className="flex items-center justify-between gap-2">

              <div className="flex items-center gap-2">

                <CalendarClock className="h-4 w-4 text-primary" />

                <div>

                  <div className="text-xs font-semibold">
                    Smart Follow-up
                  </div>

                  <div className="text-[10px] text-muted-foreground">
                    Suggested from call outcome
                  </div>

                </div>

              </div>

              <button
                type="button"
                onClick={() =>
                  setScheduleFollowUp(
                    !scheduleFollowUp,
                  )
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  scheduleFollowUp
                    ? "bg-primary"
                    : "bg-muted"
                }`}
              >

                <span
                  className={`inline-block h-4 w-4 rounded-full bg-background transition-transform ${
                    scheduleFollowUp
                      ? "translate-x-4"
                      : "translate-x-0.5"
                  }`}
                />

              </button>

            </div>

            {scheduleFollowUp && (

              <div className="space-y-2">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

                  <div>

                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Follow-up Date *
                    </Label>

                    <Input
                      type="date"
                      min={getTodayDate()}
                      value={followUpDate}
                      onChange={(e) =>
                        setFollowUpDate(
                          e.target.value,
                        )
                      }
                      className="h-8 text-xs"
                    />

                  </div>

                  <div>

                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Follow-up Time *
                    </Label>

                    <Input
                      type="time"
                      value={followUpTime}
                      onChange={(e) =>
                        setFollowUpTime(
                          e.target.value,
                        )
                      }
                      className="h-8 text-xs"
                    />

                  </div>

                </div>

                <div>

                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Follow-up Reason *
                  </Label>

                  <Textarea
                    rows={2}
                    value={followUpReason}
                    onChange={(e) =>
                      setFollowUpReason(
                        e.target.value,
                      )
                    }
                    placeholder="Why should this lead be contacted again?"
                    className="text-xs resize-none"
                  />

                </div>

                {outcome === "not-answered" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested: Tomorrow at 10:00 AM because the lead did not answer.
                  </p>

                )}

                {outcome === "busy" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested: Try again after approximately 2 hours.
                  </p>

                )}

                {outcome === "switched-off" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested: Tomorrow at 11:00 AM.
                  </p>

                )}

                {outcome === "callback-requested" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Customer requested a callback. Select their preferred date and time.
                  </p>

                )}

              </div>

            )}

          </div>

        )}

        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={submitCall}
        >

          {scheduleFollowUp
            ? "Log Call & Schedule Follow-up"
            : "Log Call"}

        </Button>

      </div>

      {/* OBJECTION LOGGER */}

      {(outcome === "answered" ||
        tours.some(
          (t) =>
            t.status === "completed",
        )) && (

        <ObjectionLogger
          lead={lead}
          context={
            tours.some(
              (t) =>
                t.status === "completed",
            )
              ? "visit"
              : "call"
          }
        />

      )}

      {/* QUOTATION */}

      <QuotationBuilder lead={lead} />

      {/* WHATSAPP */}

      <SmartWaLayer lead={lead} />

      {/* OBJECTION HISTORY */}

      {objections.length > 0 && (

        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">

          <div className="text-xs font-semibold flex items-center gap-2">

            <Sparkles className="h-3.5 w-3.5" />

            Objection history

          </div>

          {objections
            .slice(0, 4)
            .map((o) => (

              <div
                key={o.id}
                className="text-[11px] border-l-2 border-border pl-2"
              >

                <div className="font-medium">

                  {o.code}

                  {o.resolution === "yes" &&
                    " · ✓ resolved"}

                </div>

                {o.leadWords && (

                  <div className="italic text-muted-foreground">
                    "{o.leadWords}"
                  </div>

                )}

                {o.handling && (

                  <div className="text-muted-foreground">
                    → {o.handling}
                  </div>

                )}

              </div>

            ))}

        </div>

      )}

    </div>
  );
}