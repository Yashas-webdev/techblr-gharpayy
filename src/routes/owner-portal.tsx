import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useMemo, useState } from "react";

import {
  useOwnerSession,
  loginAsOwner,
  logoutOwner,
  pgsForOwnerCode,
  allOwnerAccounts,
  getPgInventory,
  setPgInventory,
  useOwnerInventory,
  ownerScorecard,
} from "@/lib/owners/account-store";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ShieldCheck,
  LogOut,
  Building2,
  Bed,
  Lock,
  Pause,
  Play,
  MapPin,
  IndianRupee,
  Save,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  CircleAlert,
  Ban,
  Users,
  BedDouble,
} from "lucide-react";

import { toast } from "sonner";
import type { PG } from "@/property-genius/data/types";

/* ============================================================
   ROUTE
   ============================================================ */

export const Route = createFileRoute("/owner-portal")({
  head: () => ({
    meta: [
      {
        title: "Owner Portal — Gharpayy",
      },
    ],
  }),

  component: () => (
    <AppShell>
      <OwnerPortalPage />
    </AppShell>
  ),
});

/* ============================================================
   SMART AVAILABILITY
   ============================================================ */

type AvailabilityLevel =
  | "high"
  | "good"
  | "limited"
  | "full"
  | "paused";

interface SmartAvailabilityResult {
  level: AvailabilityLevel;
  label: string;
  description: string;
  recommendation: string;

  occupiedBeds: number;
  sellableBeds: number;
  blockedBeds: number;

  availabilityPercent: number;
  occupancyPercent: number;
}

/**
 * Calculates the smart availability status of a PG.
 *
 * totalBeds   -> complete inventory
 * vacantBeds  -> beds that are not occupied
 * blockedBeds -> vacant beds temporarily unavailable
 * sellable    -> vacant - blocked
 */
function calculateSmartAvailability({
  totalBeds,
  vacantBeds,
  blockedBeds,
  isLive,
}: {
  totalBeds: number;
  vacantBeds: number;
  blockedBeds: number;
  isLive: boolean;
}): SmartAvailabilityResult {
  const safeTotal = Math.max(0, totalBeds);

  const safeVacant = Math.max(
    0,
    Math.min(vacantBeds, safeTotal),
  );

  const safeBlocked = Math.max(
    0,
    Math.min(blockedBeds, safeVacant),
  );

  const sellableBeds = isLive
    ? Math.max(0, safeVacant - safeBlocked)
    : 0;

  const occupiedBeds = Math.max(
    0,
    safeTotal - safeVacant,
  );

  const availabilityPercent =
    safeTotal > 0
      ? Math.round((sellableBeds / safeTotal) * 100)
      : 0;

  const occupancyPercent =
    safeTotal > 0
      ? Math.round((occupiedBeds / safeTotal) * 100)
      : 0;

  if (!isLive) {
    return {
      level: "paused",

      label: "Inventory Paused",

      description:
        "This property is currently paused and unavailable to the sales team.",

      recommendation:
        safeVacant > 0
          ? `${safeVacant} vacant bed${
              safeVacant === 1 ? "" : "s"
            } exist, but sales cannot use them until the property is made live.`
          : "Make the property live again when inventory becomes available.",

      occupiedBeds,
      sellableBeds: 0,
      blockedBeds: safeBlocked,

      availabilityPercent: 0,
      occupancyPercent,
    };
  }

  if (sellableBeds === 0) {
    return {
      level: "full",

      label: "No Availability",

      description:
        safeVacant > 0 && safeBlocked >= safeVacant
          ? "Vacant inventory exists, but all vacant beds are currently blocked."
          : "There are currently no beds available for immediate booking.",

      recommendation:
        safeBlocked > 0
          ? "Review blocked inventory and release beds when they become ready."
          : "Sales should avoid pushing this property until new vacancy is added.",

      occupiedBeds,
      sellableBeds,
      blockedBeds: safeBlocked,

      availabilityPercent,
      occupancyPercent,
    };
  }

  if (availabilityPercent >= 40) {
    return {
      level: "high",

      label: "High Availability",

      description: `${sellableBeds} bed${
        sellableBeds === 1 ? "" : "s"
      } available for immediate booking.`,

      recommendation:
        "Good inventory availability. Sales can actively push this property to matching leads.",

      occupiedBeds,
      sellableBeds,
      blockedBeds: safeBlocked,

      availabilityPercent,
      occupancyPercent,
    };
  }

  if (availabilityPercent >= 20) {
    return {
      level: "good",

      label: "Good Availability",

      description: `${sellableBeds} bed${
        sellableBeds === 1 ? "" : "s"
      } currently available for booking.`,

      recommendation:
        "Inventory is healthy, but availability should be monitored as bookings increase.",

      occupiedBeds,
      sellableBeds,
      blockedBeds: safeBlocked,

      availabilityPercent,
      occupancyPercent,
    };
  }

  return {
    level: "limited",

    label: "Limited Availability",

    description: `Only ${sellableBeds} bed${
      sellableBeds === 1 ? "" : "s"
    } currently available.`,

    recommendation:
      "Availability is running low. Prioritize high-intent leads and confirm inventory before scheduling visits.",

    occupiedBeds,
    sellableBeds,
    blockedBeds: safeBlocked,

    availabilityPercent,
    occupancyPercent,
  };
}

/* ============================================================
   OWNER PORTAL
   ============================================================ */

function OwnerPortalPage() {
  const session = useOwnerSession();

  // Subscribe so inventory updates immediately re-render this page.
  useOwnerInventory();

  const account = useMemo(
    () =>
      session
        ? allOwnerAccounts().find(
            (a) => a.code === session,
          )
        : null,
    [session],
  );

  /* ==========================================================
     NOT LOGGED IN
     ========================================================== */

  if (!session || !account) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-3">

        <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto" />

        <h1 className="text-xl font-semibold">
          No owner signed in
        </h1>

        <p className="text-sm text-muted-foreground">
          Pick an owner account first — every owner can manage
          their own PGs.
        </p>

        <Button asChild>
          <Link to="/owner-accounts">
            Browse owner accounts
          </Link>
        </Button>

      </div>
    );
  }

  /* ==========================================================
     OWNER DATA
     ========================================================== */

  const pgs = pgsForOwnerCode(session);

  const sc = ownerScorecard(session);

  const accounts = allOwnerAccounts();

  const switchOwner = (code: string) => {
    const next = accounts.find(
      (a) => a.code === code,
    );

    loginAsOwner(code);

    toast.success(
      `Switched to ${next?.name ?? code}`,
    );
  };

  /* ==========================================================
     PAGE
     ========================================================== */

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">

      {/* ======================================================
          HEADER
          ====================================================== */}

      <header className="flex items-start justify-between gap-3 flex-wrap">

        <div>

          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Owner Portal
          </div>

          <h1 className="text-2xl font-display font-semibold flex items-center gap-2">

            <ShieldCheck className="h-5 w-5 text-primary" />

            {account.name}

          </h1>

          <div className="text-[11px] text-muted-foreground mt-0.5">

            <span className="font-mono">
              {account.code}
            </span>

            {account.phone && (
              <span>
                {" "}· {account.phone}
              </span>
            )}

          </div>

        </div>

        <div className="flex items-center gap-2 flex-wrap">

          <Select
            value={session}
            onValueChange={switchOwner}
          >

            <SelectTrigger className="h-8 w-[210px] text-xs">
              <SelectValue placeholder="Switch owner" />
            </SelectTrigger>

            <SelectContent>

              {accounts.map((a) => (
                <SelectItem
                  key={a.code}
                  value={a.code}
                >
                  {a.name}
                </SelectItem>
              ))}

            </SelectContent>

          </Select>

          <Badge
            variant="outline"
            className="gap-1"
          >
            <Building2 className="h-3 w-3" />
            {sc.pgCount} PGs
          </Badge>

          <Badge
            variant="outline"
            className="gap-1"
          >
            <Bed className="h-3 w-3" />
            {sc.availableBeds} live beds
          </Badge>

          {sc.paused > 0 && (
            <Badge variant="destructive">
              {sc.paused} paused
            </Badge>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              logoutOwner();
              toast.success("Signed out");
            }}
          >

            <LogOut className="h-3.5 w-3.5 mr-1" />

            Sign out

          </Button>

        </div>

      </header>

      {/* ======================================================
          NAVIGATION
          ====================================================== */}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">

        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 justify-start text-xs"
        >
          <Link to="/owner">

            <ShieldCheck className="h-3.5 w-3.5 mr-1" />

            Owner desk

          </Link>
        </Button>

        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 justify-start text-xs"
        >
          <Link to="/owner/rooms">

            <Bed className="h-3.5 w-3.5 mr-1" />

            Update rooms

          </Link>
        </Button>

        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 justify-start text-xs"
        >
          <Link to="/owner/blocks">

            <Lock className="h-3.5 w-3.5 mr-1" />

            Room blocks

          </Link>
        </Button>

        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 justify-start text-xs"
        >
          <Link to="/owner/visits">

            <ArrowRight className="h-3.5 w-3.5 mr-1" />

            Visits

          </Link>
        </Button>

        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 justify-start text-xs"
        >
          <Link to="/owner-accounts">

            <Building2 className="h-3.5 w-3.5 mr-1" />

            All owners

          </Link>
        </Button>

      </div>

      {/* ======================================================
          INFORMATION
          ====================================================== */}

      <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">

        <AlertTriangle className="h-4 w-4 text-do-today mt-0.5 shrink-0" />

        <div>
          Every change here flows live into the Impact Queue.
          If you pause a PG or set vacant beds to 0, the sales
          team can’t schedule new tours there until you update
          again.
        </div>

      </div>

      {/* ======================================================
          PG INVENTORY
          ====================================================== */}

      <div className="space-y-3">

        {pgs.map((pg) => (
          <PgInventoryRow
            key={pg.id}
            pg={pg}
          />
        ))}

        {pgs.length === 0 && (

          <div className="text-center text-sm text-muted-foreground py-12">
            No properties mapped to this owner yet.
          </div>

        )}

      </div>

    </div>
  );
}

/* ============================================================
   PG INVENTORY ROW
   ============================================================ */

function PgInventoryRow({
  pg,
}: {
  pg: PG;
}) {
  const inv = getPgInventory(pg.id);

  /* ==========================================================
     FORM STATE
     ========================================================== */

  const [totalBeds, setTotal] =
    useState(inv?.totalBeds ?? 20);

  const [vacantBeds, setVacant] =
    useState(inv?.vacantBeds ?? 5);

  const [blockedBeds, setBlocked] =
    useState(inv?.blockedBeds ?? 0);

  const [blockReason, setBlockReason] =
    useState(inv?.blockReason ?? "");

  const [isLive, setIsLive] =
    useState(inv?.isLive ?? true);

  const [note, setNote] =
    useState(inv?.note ?? "");

  /* ==========================================================
     VALIDATION
     ========================================================== */

  const vacantTooHigh =
    vacantBeds > totalBeds;

  const blockedTooHigh =
    blockedBeds > vacantBeds;

  const hasInventoryError =
    totalBeds < 1 ||
    vacantTooHigh ||
    blockedTooHigh;

  /* ==========================================================
     EXISTING FREE BED CALCULATION
     ========================================================== */

  const free = isLive
    ? Math.max(
        0,
        Math.min(vacantBeds, totalBeds) -
          Math.min(blockedBeds, vacantBeds),
      )
    : 0;

  /* ==========================================================
     SMART AVAILABILITY
     ========================================================== */

  const smartAvailability =
    calculateSmartAvailability({
      totalBeds,
      vacantBeds,
      blockedBeds,
      isLive,
    });

  /* ==========================================================
     PRICE
     ========================================================== */

  const price =
    pg.prices?.double ||
    pg.prices?.single ||
    pg.prices?.triple ||
    pg.prices?.min ||
    0;

  /* ==========================================================
     DIRTY CHECK
     ========================================================== */

  const dirty =
    !inv ||
    inv.totalBeds !== totalBeds ||
    inv.vacantBeds !== vacantBeds ||
    inv.blockedBeds !== blockedBeds ||
    inv.isLive !== isLive ||
    (inv.blockReason ?? "") !== blockReason ||
    (inv.note ?? "") !== note;

  /* ==========================================================
     SMART UI STYLES
     ========================================================== */

  const smartCardStyle =
    smartAvailability.level === "high"
      ? "border-success/40 bg-success/5"
      : smartAvailability.level === "good"
        ? "border-primary/30 bg-primary/5"
        : smartAvailability.level === "limited"
          ? "border-warning/40 bg-warning/5"
          : smartAvailability.level === "full"
            ? "border-destructive/40 bg-destructive/5"
            : "border-muted-foreground/30 bg-muted/30";

  const smartTextStyle =
    smartAvailability.level === "high"
      ? "text-success"
      : smartAvailability.level === "good"
        ? "text-primary"
        : smartAvailability.level === "limited"
          ? "text-warning"
          : smartAvailability.level === "full"
            ? "text-destructive"
            : "text-muted-foreground";

  /* ==========================================================
     SAVE
     ========================================================== */

  const save = () => {
    if (totalBeds < 1) {
      toast.error(
        "Total beds must be at least 1.",
      );

      return;
    }

    if (vacantBeds > totalBeds) {
      toast.error(
        "Vacant beds cannot be greater than total beds.",
      );

      return;
    }

    if (blockedBeds > vacantBeds) {
      toast.error(
        "Blocked beds cannot be greater than vacant beds.",
      );

      return;
    }

    if (
      blockedBeds > 0 &&
      !blockReason.trim()
    ) {
      toast.error(
        "Please enter a reason for blocking the beds.",
      );

      return;
    }

    setPgInventory(pg.id, {
      totalBeds,
      vacantBeds,
      blockedBeds,
      blockReason:
        blockedBeds > 0
          ? blockReason.trim()
          : "",
      isLive,
      note,
    });

    toast.success(
      `${pg.name} updated · ${free} beds live`,
    );
  };

  /* ==========================================================
     UI
     ========================================================== */

  return (
    <div
      className={`rounded-lg border bg-card p-4 space-y-4 ${
        !isLive
          ? "opacity-90 border-destructive/40"
          : ""
      }`}
    >

      {/* ======================================================
          PROPERTY HEADER
          ====================================================== */}

      <div className="flex items-start justify-between gap-3 flex-wrap">

        <div className="min-w-0">

          <div className="font-semibold truncate">
            {pg.name}
          </div>

          <div className="text-[11px] text-muted-foreground flex items-center gap-3 mt-0.5 flex-wrap">

            <span className="flex items-center gap-1">

              <MapPin className="h-3 w-3" />

              {pg.area}

            </span>

            {price > 0 && (

              <span className="flex items-center gap-1">

                <IndianRupee className="h-3 w-3" />

                {price.toLocaleString(
                  "en-IN",
                )}
                /mo

              </span>

            )}

            <span className="font-mono">
              {pg.id}
            </span>

          </div>

        </div>

        <div className="flex items-center gap-2">

          <Badge
            variant={
              free > 0
                ? "outline"
                : "destructive"
            }
            className="gap-1"
          >

            <Bed className="h-3 w-3" />

            {free} beds live

          </Badge>

          <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]">

            {isLive ? (

              <Play className="h-3 w-3 text-won" />

            ) : (

              <Pause className="h-3 w-3 text-destructive" />

            )}

            <Switch
              checked={isLive}
              onCheckedChange={setIsLive}
            />

            <span>
              {isLive
                ? "Live"
                : "Paused"}
            </span>

          </div>

        </div>

      </div>

      {/* ======================================================
          SMART AVAILABILITY
          ====================================================== */}

      <div
        className={`rounded-lg border p-3 space-y-3 ${smartCardStyle}`}
      >

        {/* HEADER */}

        <div className="flex items-start justify-between gap-3">

          <div className="flex items-start gap-2">

            <div className="rounded-md border bg-background/60 p-1.5">

              <Sparkles
                className={`h-4 w-4 ${smartTextStyle}`}
              />

            </div>

            <div>

              <div className="flex items-center gap-2 flex-wrap">

                <span className="text-xs font-semibold">
                  Smart Availability
                </span>

                <span
                  className={`text-[9px] uppercase font-semibold tracking-wide ${smartTextStyle}`}
                >
                  {smartAvailability.label}
                </span>

              </div>

              <p className="text-[11px] text-muted-foreground mt-1">
                {smartAvailability.description}
              </p>

            </div>

          </div>

          <div className="text-right shrink-0">

            <div
              className={`text-xl font-bold ${smartTextStyle}`}
            >
              {
                smartAvailability.availabilityPercent
              }
              %
            </div>

            <div className="text-[9px] uppercase text-muted-foreground">
              Available
            </div>

          </div>

        </div>

        {/* AVAILABILITY BAR */}

        <div className="space-y-1">

          <div className="flex items-center justify-between text-[10px]">

            <span className="text-muted-foreground">
              Immediate availability
            </span>

            <span className="font-medium">
              {
                smartAvailability.sellableBeds
              }
              /{totalBeds} beds
            </span>

          </div>

          <div className="h-2 rounded-full bg-muted overflow-hidden">

            <div
              className={
                smartAvailability.level ===
                "high"
                  ? "h-full bg-success transition-all duration-500"
                  : smartAvailability.level ===
                      "good"
                    ? "h-full bg-primary transition-all duration-500"
                    : smartAvailability.level ===
                        "limited"
                      ? "h-full bg-warning transition-all duration-500"
                      : "h-full bg-destructive transition-all duration-500"
              }
              style={{
                width: `${Math.min(
                  100,
                  smartAvailability.availabilityPercent,
                )}%`,
              }}
            />

          </div>

        </div>

        {/* STATS */}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">

          {/* TOTAL */}

          <div className="rounded-md border bg-background/50 p-2">

            <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">

              <BedDouble className="h-3 w-3" />

              Total

            </div>

            <div className="text-lg font-semibold mt-0.5">
              {totalBeds}
            </div>

            <div className="text-[9px] text-muted-foreground">
              beds
            </div>

          </div>

          {/* OCCUPIED */}

          <div className="rounded-md border bg-background/50 p-2">

            <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">

              <Users className="h-3 w-3" />

              Occupied

            </div>

            <div className="text-lg font-semibold mt-0.5">
              {
                smartAvailability.occupiedBeds
              }
            </div>

            <div className="text-[9px] text-muted-foreground">
              {
                smartAvailability.occupancyPercent
              }
              % occupancy
            </div>

          </div>

          {/* SELLABLE */}

          <div className="rounded-md border bg-background/50 p-2">

            <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">

              <CheckCircle2 className="h-3 w-3 text-success" />

              Sellable

            </div>

            <div className="text-lg font-semibold mt-0.5 text-success">
              {
                smartAvailability.sellableBeds
              }
            </div>

            <div className="text-[9px] text-muted-foreground">
              ready now
            </div>

          </div>

          {/* BLOCKED */}

          <div className="rounded-md border bg-background/50 p-2">

            <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground">

              <Lock className="h-3 w-3" />

              Blocked

            </div>

            <div className="text-lg font-semibold mt-0.5">
              {
                smartAvailability.blockedBeds
              }
            </div>

            <div className="text-[9px] text-muted-foreground">
              unavailable
            </div>

          </div>

        </div>

        {/* SMART RECOMMENDATION */}

        <div className="rounded-md border bg-background/50 px-2.5 py-2 flex items-start gap-2">

          {smartAvailability.level ===
          "high" ? (

            <TrendingUp className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />

          ) : smartAvailability.level ===
            "full" ? (

            <Ban className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />

          ) : smartAvailability.level ===
            "limited" ? (

            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />

          ) : (

            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />

          )}

          <div>

            <div className="text-[9px] uppercase tracking-wider font-medium text-muted-foreground">
              Smart recommendation
            </div>

            <div className="text-[11px] mt-0.5">
              {
                smartAvailability.recommendation
              }
            </div>

          </div>

        </div>

      </div>

      {/* ======================================================
          INVENTORY VALIDATION WARNING
          ====================================================== */}

      {hasInventoryError && (

        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">

          <div className="flex items-start gap-2">

            <CircleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />

            <div>

              <div className="text-xs font-semibold text-destructive">
                Invalid inventory
              </div>

              <div className="space-y-1 mt-1 text-[11px] text-muted-foreground">

                {totalBeds < 1 && (
                  <div>
                    • Total beds must be at least 1.
                  </div>
                )}

                {vacantTooHigh && (
                  <div>
                    • Vacant beds ({vacantBeds}) cannot exceed total beds ({totalBeds}).
                  </div>
                )}

                {blockedTooHigh && (
                  <div>
                    • Blocked beds ({blockedBeds}) cannot exceed vacant beds ({vacantBeds}).
                  </div>
                )}

              </div>

            </div>

          </div>

        </div>

      )}

      {/* ======================================================
          INVENTORY INPUTS
          ====================================================== */}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* TOTAL BEDS */}

        <div>

          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total beds
          </Label>

          <Input
            type="number"
            min={1}
            className={`h-8 text-xs ${
              totalBeds < 1
                ? "border-destructive"
                : ""
            }`}
            value={totalBeds}
            onChange={(e) =>
              setTotal(
                Math.max(
                  0,
                  Number(e.target.value) || 0,
                ),
              )
            }
          />

        </div>

        {/* VACANT */}

        <div>

          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Vacant beds
          </Label>

          <Input
            type="number"
            min={0}
            className={`h-8 text-xs ${
              vacantTooHigh
                ? "border-destructive"
                : ""
            }`}
            value={vacantBeds}
            onChange={(e) =>
              setVacant(
                Math.max(
                  0,
                  Number(e.target.value) || 0,
                ),
              )
            }
          />

        </div>

        {/* BLOCKED */}

        <div>

          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">

            <Lock className="h-3 w-3" />

            Blocked by me

          </Label>

          <Input
            type="number"
            min={0}
            className={`h-8 text-xs ${
              blockedTooHigh
                ? "border-destructive"
                : ""
            }`}
            value={blockedBeds}
            onChange={(e) =>
              setBlocked(
                Math.max(
                  0,
                  Number(e.target.value) || 0,
                ),
              )
            }
          />

        </div>

        {/* BLOCK REASON */}

        <div>

          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Block reason
          </Label>

          <Input
            className="h-8 text-xs"
            placeholder="e.g. painting, family use"
            value={blockReason}
            disabled={blockedBeds === 0}
            onChange={(e) =>
              setBlockReason(
                e.target.value,
              )
            }
          />

        </div>

      </div>

      {/* ======================================================
          BLOCKED BED INFO
          ====================================================== */}

      {blockedBeds > 0 &&
        blockedBeds <= vacantBeds && (

          <div className="rounded-md bg-muted/30 border px-3 py-2 text-[11px] text-muted-foreground">

            <span className="font-medium text-foreground">
              {vacantBeds} vacant
            </span>

            {" "}−{" "}

            <span className="font-medium text-foreground">
              {blockedBeds} blocked
            </span>

            {" "}={" "}

            <span className="font-semibold text-success">
              {Math.max(
                0,
                vacantBeds - blockedBeds,
              )}{" "}
              sellable beds
            </span>

          </div>

        )}

      {/* ======================================================
          SALES NOTE
          ====================================================== */}

      <div>

        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Note for the sales team
        </Label>

        <Input
          className="h-8 text-xs"
          placeholder="e.g. AC repaired, ready to show after 5pm"
          value={note}
          onChange={(e) =>
            setNote(e.target.value)
          }
        />

      </div>

      {/* ======================================================
          SAVE
          ====================================================== */}

      <div className="flex items-center justify-between gap-2 pt-1">

        <div className="text-[11px] text-muted-foreground">

          {inv ? (
            <>
              Last updated{" "}
              {new Date(
                inv.updatedAt,
              ).toLocaleString()}
            </>
          ) : (
            <>
              Never updated — sales team is using default estimates.
            </>
          )}

        </div>

        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={
            !dirty ||
            hasInventoryError
          }
          onClick={save}
        >

          <Save className="h-3.5 w-3.5" />

          {dirty
            ? "Save changes"
            : "Saved"}

        </Button>

      </div>

    </div>
  );
}