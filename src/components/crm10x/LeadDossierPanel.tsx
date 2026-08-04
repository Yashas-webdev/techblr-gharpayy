import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useCRM10x } from "@/lib/crm10x/store";
import {
  computeBookingProbability,
  inferBestCallTime,
} from "@/lib/crm10x/intelligence";
import { useCalendar } from "@/lib/calendar-store";

import type { Lead } from "@/lib/types";
import type {
  CallOutcome,
  LangPref,
} from "@/lib/crm10x/types";

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
   SMART FOLLOW-UP SUGGESTION
   ============================================================ */

function getSuggestedFollowUp(
  outcome: CallOutcome,
): {
  date: string;
  time: string;
  reason: string;
} | null {
  const now = new Date();

  /* ----------------------------------------------------------
     NOT ANSWERED
     Suggest tomorrow morning
     ---------------------------------------------------------- */

  if (outcome === "not-answered") {
    return {
      date: getTomorrowDate(),
      time: "10:00",
      reason: "Lead did not answer. Try again tomorrow morning.",
    };
  }

  /* ----------------------------------------------------------
     BUSY
     Suggest approximately 2 hours later
     ---------------------------------------------------------- */

  if (outcome === "busy") {
    const later = new Date(
      now.getTime() + 2 * 60 * 60 * 1000,
    );

    const date = [
      later.getFullYear(),
      String(later.getMonth() + 1).padStart(2, "0"),
      String(later.getDate()).padStart(2, "0"),
    ].join("-");

    const time = `${String(
      later.getHours(),
    ).padStart(2, "0")}:${String(
      later.getMinutes(),
    ).padStart(2, "0")}`;

    return {
      date,
      time,
      reason: "Lead was busy. Follow up again after 2 hours.",
    };
  }

  /* ----------------------------------------------------------
     SWITCHED OFF
     Suggest tomorrow
     ---------------------------------------------------------- */

  if (outcome === "switched-off") {
    return {
      date: getTomorrowDate(),
      time: "11:00",
      reason:
        "Phone was switched off. Try again tomorrow.",
    };
  }

  /* ----------------------------------------------------------
     CALLBACK REQUESTED

     We enable the form but let the TCM choose the exact time.
     ---------------------------------------------------------- */

  if (outcome === "callback-requested") {
    return {
      date: getTodayDate(),
      time: "",
      reason: "Customer requested a callback.",
    };
  }

  return null;
}

/* ============================================================
   FOLLOW-UP REQUIRED?
   ============================================================ */

function shouldSuggestFollowUp(
  outcome: CallOutcome,
) {
  return [
    "not-answered",
    "busy",
    "switched-off",
    "callback-requested",
  ].includes(outcome);
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
     EXISTING STORES
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

  /* ==========================================================
     CALENDAR
     ========================================================== */

  const addCalendarEvent = useCalendar(
    (s) => s.addEvent,
  );

  /* ==========================================================
     LEAD DATA
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
      Object.values(
        visitsRecord,
      ).filter(
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

     Keep the logic that was working correctly for you.
     ========================================================== */

  const bestTime = useMemo(() => {
    const latestCallWithBestTime =
      calls.find(
        (call) =>
          call.bestCallTime,
      );

    return (
      latestCallWithBestTime?.bestCallTime ??
      profile?.bestCallTime ??
      inferBestCallTime(calls) ??
      "—"
    );
  }, [
    calls,
    profile?.bestCallTime,
  ]);

  /* ==========================================================
     CALL FORM STATE
     ========================================================== */

  const [duration, setDuration] =
    useState(60);

  const [outcome, setOutcome] =
    useState<CallOutcome>(
      "answered",
    );

  const [language, setLanguage] =
    useState<LangPref | "">("");

  const [
    bestCallTime,
    setBestCallTime,
  ] = useState("");

  const [customHour, setCustomHour] =
    useState("06");

  const [
    customMinute,
    setCustomMinute,
  ] = useState("00");

  const [
    customPeriod,
    setCustomPeriod,
  ] = useState<
    "AM" | "PM"
  >("PM");

  const [notes, setNotes] =
    useState("");

  /* ==========================================================
     SMART FOLLOW-UP STATE
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

     Automatically generate smart recommendation.
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

      setFollowUpDate(
        suggestion.date,
      );

      setFollowUpTime(
        suggestion.time,
      );

      setFollowUpReason(
        suggestion.reason,
      );
    } else {
      setScheduleFollowUp(false);

      setFollowUpDate("");

      setFollowUpTime("");

      setFollowUpReason("");
    }
  };

  /* ==========================================================
     CUSTOM BEST CALL TIME
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
     SUBMIT CALL
     ========================================================== */

  const submitCall = () => {
    /* --------------------------------------------------------
       REQUIRED CALL FIELDS
       -------------------------------------------------------- */

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

    if (
      !duration ||
      duration <= 0
    ) {
      toast.error(
        "Enter a valid call duration",
      );

      return;
    }

    /* --------------------------------------------------------
       FOLLOW-UP VALIDATION
       -------------------------------------------------------- */

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

      if (
        !followUpReason.trim()
      ) {
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

    /* --------------------------------------------------------
       LOG EXISTING CALL
       -------------------------------------------------------- */

    logCall({
      leadId: lead.id,

      attemptNumber:
        calls.length + 1,

      durationSec:
        duration,

      outcome,

      language:
        language ||
        undefined,

      bestCallTime:
        bestCallTime ||
        undefined,

      notes,

      loggedBy:
        lead.assignedTcmId,
    });

    /* ========================================================
       CREATE FOLLOW-UP CALENDAR EVENT
       ======================================================== */

    if (
      scheduleFollowUp &&
      followUpDate &&
      followUpTime
    ) {
      const startDate =
        new Date(
          `${followUpDate}T${followUpTime}:00`,
        );

      /*
       * Follow-up call duration:
       * 30 minutes.
       */
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

        allDay:
          false,

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

        leadId:
          lead.id,

        externalSource:
          "local",

        reminder:
          15,
      });
    }

    /* ========================================================
       SUCCESS MESSAGE
       ======================================================== */

    if (scheduleFollowUp) {
      toast.success(
        "Call logged and follow-up scheduled",
      );
    } else {
      toast.success(
        "Call logged",
      );
    }

    /* ========================================================
       RESET FORM
       ======================================================== */

    setNotes("");

    setBestCallTime("");

    setLanguage("");

    setScheduleFollowUp(false);

    setFollowUpDate("");

    setFollowUpTime("");

    setFollowUpReason("");
  };

  /* ==========================================================
     PROBABILITY COLOR
     ========================================================== */

  const tone =
    probability.score >= 75
      ? "text-success border-success/40 bg-success/10"
      : probability.score >= 50
        ? "text-accent border-accent/40 bg-accent/10"
        : probability.score >= 30
          ? "text-warning border-warning/40 bg-warning/10"
          : "text-muted-foreground border-border bg-muted/40";

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
          {
            probability.recommendation
          }
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
                {s.impact > 0
                  ? "+"
                  : ""}

                {s.impact} ·{" "}
                {s.label}
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
          · Attempts:{" "}
          {calls.length}
        </span>

      </div>

      <ContactOutcomeChips
        lead={lead}
      />

      <LeadDeepProfile
        lead={lead}
      />

      {/* ======================================================
          CALL LOGGER
          ====================================================== */}

      <div className="rounded-lg border border-border bg-card p-3 space-y-3">

        <div className="text-xs font-semibold flex items-center gap-2">

          <Phone className="h-3.5 w-3.5" />

          Log call (attempt #
          {calls.length + 1})

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
                  Number(
                    e.target.value,
                  ),
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

        {/* ====================================================
            CUSTOM BEST CALL TIME
            ==================================================== */}

        {bestCallTime ===
          "custom" && (

          <div className="rounded-md border border-border bg-muted/20 p-2">

            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Custom call time
            </Label>

            <div className="grid grid-cols-3 gap-2 mt-1">

              {/* HOUR */}

              <Input
                type="number"
                min={1}
                max={12}
                value={
                  customHour
                }
                onChange={(e) => {
                  let hour =
                    Number(
                      e.target
                        .value,
                    );

                  if (hour < 1)
                    hour = 1;

                  if (hour > 12)
                    hour = 12;

                  const value =
                    String(
                      hour,
                    ).padStart(
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

              {/* MINUTE */}

              <Input
                type="number"
                min={0}
                max={59}
                value={
                  customMinute
                }
                onChange={(e) => {
                  let minute =
                    Number(
                      e.target
                        .value,
                    );

                  if (minute < 0)
                    minute = 0;

                  if (minute > 59)
                    minute = 59;

                  const value =
                    String(
                      minute,
                    ).padStart(
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

              {/* AM PM */}

              <Select
                value={
                  customPeriod
                }
                onValueChange={(
                  v,
                ) => {
                  const period =
                    v as
                      | "AM"
                      | "PM";

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

        {/* ====================================================
            NOTES
            ==================================================== */}

        <Textarea
          rows={2}
          className="text-xs resize-none"
          placeholder="Call notes…"
          value={notes}
          onChange={(e) =>
            setNotes(
              e.target.value,
            )
          }
        />

        {/* ====================================================
            SMART FOLLOW-UP
            ==================================================== */}

        {shouldSuggestFollowUp(
          outcome,
        ) && (

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">

            <div className="flex items-center justify-between gap-2">

              <div className="flex items-center gap-2">

                <CalendarClock className="h-4 w-4 text-primary" />

                <div>

                  <div className="text-xs font-semibold">
                    Smart Follow-up
                  </div>

                  <div className="text-[10px] text-muted-foreground">
                    Suggested from
                    call outcome
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

                  {/* FOLLOW-UP DATE */}

                  <div>

                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Follow-up Date *
                    </Label>

                    <Input
                      type="date"
                      min={
                        getTodayDate()
                      }
                      value={
                        followUpDate
                      }
                      onChange={(e) =>
                        setFollowUpDate(
                          e.target
                            .value,
                        )
                      }
                      className="h-8 text-xs"
                    />

                  </div>

                  {/* FOLLOW-UP TIME */}

                  <div>

                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Follow-up Time *
                    </Label>

                    <Input
                      type="time"
                      value={
                        followUpTime
                      }
                      onChange={(e) =>
                        setFollowUpTime(
                          e.target
                            .value,
                        )
                      }
                      className="h-8 text-xs"
                    />

                  </div>

                </div>

                {/* REASON */}

                <div>

                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Follow-up Reason *
                  </Label>

                  <Textarea
                    rows={2}
                    value={
                      followUpReason
                    }
                    onChange={(e) =>
                      setFollowUpReason(
                        e.target
                          .value,
                      )
                    }
                    placeholder="Why should this lead be contacted again?"
                    className="text-xs resize-none"
                  />

                </div>

                {/* SMART SUGGESTION */}

                {outcome ===
                  "not-answered" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested:
                    Tomorrow at
                    10:00 AM because
                    the lead did not
                    answer.
                  </p>
                )}

                {outcome ===
                  "busy" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested:
                    Try again after
                    approximately 2
                    hours.
                  </p>
                )}

                {outcome ===
                  "switched-off" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Suggested:
                    Tomorrow at
                    11:00 AM.
                  </p>
                )}

                {outcome ===
                  "callback-requested" && (

                  <p className="text-[10px] text-muted-foreground">
                    💡 Customer
                    requested a
                    callback. Select
                    their preferred
                    date and time.
                  </p>
                )}

              </div>
            )}

          </div>
        )}

        {/* ====================================================
            LOG CALL
            ==================================================== */}

        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={
            submitCall
          }
        >
          {scheduleFollowUp
            ? "Log Call & Schedule Follow-up"
            : "Log Call"}
        </Button>

      </div>

      {/* ======================================================
          OBJECTION LOGGER
          ====================================================== */}

      {(outcome ===
        "answered" ||
        tours.some(
          (t) =>
            t.status ===
            "completed",
        )) && (

        <ObjectionLogger
          lead={lead}
          context={
            tours.some(
              (t) =>
                t.status ===
                "completed",
            )
              ? "visit"
              : "call"
          }
        />

      )}

      <QuotationBuilder
        lead={lead}
      />

      <SmartWaLayer
        lead={lead}
      />

      {/* ======================================================
          OBJECTION HISTORY
          ====================================================== */}

      {objections.length >
        0 && (

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

                  {o.resolution ===
                    "yes" &&
                    " · ✓ resolved"}

                </div>

                {o.leadWords && (

                  <div className="italic text-muted-foreground">
                    "
                    {o.leadWords}
                    "
                  </div>

                )}

                {o.handling && (

                  <div className="text-muted-foreground">
                    →{" "}
                    {o.handling}
                  </div>

                )}

              </div>

            ))}

        </div>
      )}

    </div>
  );
}