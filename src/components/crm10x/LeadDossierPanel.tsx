import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useCRM10x } from "@/lib/crm10x/store";
import {
  computeBookingProbability,
  inferBestCallTime,
} from "@/lib/crm10x/intelligence";
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
import { Phone, Sparkles, Trophy, Clock } from "lucide-react";
import { toast } from "sonner";
import { ObjectionLogger } from "./ObjectionLogger";
import { LeadDeepProfile } from "./LeadDeepProfile";
import { SmartWaLayer } from "./SmartWaLayer";
import { QuotationBuilder } from "./QuotationBuilder";
import { ContactOutcomeChips } from "./ContactOutcomeChips";

/**
 * The "Dossier" tab — booking probability, best-call-time, deep profile,
 * call logger with attempts/duration/outcome, objection capture, WA templates.
 */
export function LeadDossierPanel({ lead }: { lead: Lead }) {
  const allTours = useApp((s) => s.tours);
  const profile = useCRM10x((s) => s.profiles[lead.id]);
  const allObjections = useCRM10x((s) => s.objections);
  const allCalls = useCRM10x((s) => s.calls);
  const visitsRecord = useCRM10x((s) => s.visits);
  const logCall = useCRM10x((s) => s.logCall);

  const tours = useMemo(
    () => allTours.filter((t) => t.leadId === lead.id),
    [allTours, lead.id],
  );

  const objections = useMemo(
    () => allObjections.filter((o) => o.leadId === lead.id),
    [allObjections, lead.id],
  );

  const calls = useMemo(
    () => allCalls.filter((c) => c.leadId === lead.id),
    [allCalls, lead.id],
  );

  const visits = useMemo(
    () => Object.values(visitsRecord).filter((v) => v.leadId === lead.id),
    [visitsRecord, lead.id],
  );

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
    [lead, profile, tours, visits, objections, calls],
  );

  const bestTime = useMemo(() => inferBestCallTime(calls), [calls]);

  // Call form state
  const [duration, setDuration] = useState(60);
  const [outcome, setOutcome] = useState<CallOutcome>("answered");
  const [language, setLanguage] = useState<LangPref | "">("");

  // Best call time
  const [bestCallTime, setBestCallTime] = useState("");
  const [customHour, setCustomHour] = useState("06");
  const [customMinute, setCustomMinute] = useState("00");
  const [customPeriod, setCustomPeriod] = useState<"AM" | "PM">("PM");

  const [notes, setNotes] = useState("");

  const submitCall = () => {
    // If Custom Time is selected, convert the selected
    // hour/minute/period into a readable time.
    const finalBestCallTime =
      bestCallTime === "custom"
        ? `${customHour.padStart(2, "0")}:${customMinute.padStart(
            2,
            "0",
          )} ${customPeriod}`
        : bestCallTime;

    logCall({
      leadId: lead.id,
      attemptNumber: calls.length + 1,
      durationSec: duration,
      outcome,
      language: language || undefined,
      bestCallTime: finalBestCallTime || undefined,
      notes,
      loggedBy: lead.assignedTcmId,
    });

    toast.success("Call logged");

    // Reset form
    setNotes("");
    setBestCallTime("");
    setCustomHour("06");
    setCustomMinute("00");
    setCustomPeriod("PM");
  };

  const tone =
    probability.score >= 75
      ? "text-success border-success/40 bg-success/10"
      : probability.score >= 50
        ? "text-accent border-accent/40 bg-accent/10"
        : probability.score >= 30
          ? "text-warning border-warning/40 bg-warning/10"
          : "text-muted-foreground border-border bg-muted/40";

  return (
    <div className="space-y-4">
      {/* Probability card */}
      <div className={`rounded-lg border p-3 ${tone}`}>
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
          {probability.signals.slice(0, 6).map((s, i) => (
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

      {/* Best time chip */}
      <div className="flex items-center gap-2 text-xs">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />

        <span className="text-muted-foreground">
          Best time to call:
        </span>

        <span className="font-medium">
          {bestTime ?? profile?.bestCallTime ?? "—"}
        </span>

        <span className="text-muted-foreground">
          · Attempts: {calls.length}
        </span>
      </div>

      <ContactOutcomeChips lead={lead} />

      <LeadDeepProfile lead={lead} />

      {/* Call logger */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="text-xs font-semibold flex items-center gap-2">
          <Phone className="h-3.5 w-3.5" />
          Log call (attempt #{calls.length + 1})
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Duration */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Duration (sec)
            </Label>

            <Input
              type="number"
              className="h-8 text-xs"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>

          {/* Outcome */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Outcome
            </Label>

            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as CallOutcome)}
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

          {/* Language */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Language
            </Label>

            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as LangPref)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="—" />
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

          {/* Best Call Time */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Best call time
            </Label>

            <Select
              value={bestCallTime}
              onValueChange={setBestCallTime}
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

        {/* Custom Time Picker */}
        {bestCallTime === "custom" && (
          <div className="grid grid-cols-3 gap-2">
            {/* Hour */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hour
              </Label>

              <Input
                type="number"
                min={1}
                max={12}
                value={customHour}
                onChange={(e) => {
                  const value = e.target.value;

                  if (value === "") {
                    setCustomHour("");
                    return;
                  }

                  const hour = Number(value);

                  if (hour >= 1 && hour <= 12) {
                    setCustomHour(value);
                  }
                }}
                className="h-8 text-xs"
              />
            </div>

            {/* Minute */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Minute
              </Label>

              <Input
                type="number"
                min={0}
                max={59}
                step={5}
                value={customMinute}
                onChange={(e) => {
                  const value = e.target.value;

                  if (value === "") {
                    setCustomMinute("");
                    return;
                  }

                  const minute = Number(value);

                  if (minute >= 0 && minute <= 59) {
                    setCustomMinute(value);
                  }
                }}
                className="h-8 text-xs"
              />
            </div>

            {/* AM / PM */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                AM / PM
              </Label>

              <Select
                value={customPeriod}
                onValueChange={(value) =>
                  setCustomPeriod(value as "AM" | "PM")
                }
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

        {/* Notes */}
        <Textarea
          rows={2}
          className="text-xs resize-none"
          placeholder="Notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={submitCall}
        >
          Log call
        </Button>
      </div>

      {/* Objection logger */}
      {(outcome === "answered" ||
        tours.some((t) => t.status === "completed")) && (
        <ObjectionLogger
          lead={lead}
          context={
            tours.some((t) => t.status === "completed")
              ? "visit"
              : "call"
          }
        />
      )}

      <QuotationBuilder lead={lead} />

      <SmartWaLayer lead={lead} />

      {/* Recent objections */}
      {objections.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
          <div className="text-xs font-semibold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Objection history
          </div>

          {objections.slice(0, 4).map((o) => (
            <div
              key={o.id}
              className="text-[11px] border-l-2 border-border pl-2"
            >
              <div className="font-medium">
                {o.code}
                {o.resolution === "yes" && " · ✓ resolved"}
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