import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/myt/lib/app-context';
import { useApp } from '@/lib/store';
import { useCalendar } from '@/lib/calendar-store';
import { zones, teamMembers } from '@/myt/lib/mock-data';
import { properties as allProperties } from '@/myt/lib/properties-seed';
import {
  Tour,
  BookingSource,
  TourType,
  WillBookToday,
  DecisionMaker,
  TourQualification,
} from '@/myt/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  scoreTour,
  inferConfirmationStrength,
  intentBg,
} from '@/myt/lib/confidence';
import { autoAssignTcm } from '@/myt/lib/auto-assign';
import { createBlockForTour } from '@/myt/lib/blocks';
import { ConfidenceBar } from '@/myt/components/ConfidenceBar';
import {
  SlotPicker,
  getTakenSlotsForDate,
} from '@/myt/components/SlotPicker';
import {
  Building2,
  Video,
  Briefcase,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  sendTourMessage,
  logTourEvent,
} from '@/myt/lib/tour-messages';

const todayStr = () =>
  new Date().toISOString().split('T')[0];

const in7days = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
};

const roomTypes = [
  'Single',
  'Double Sharing',
  'Triple Sharing',
  'Studio',
];

interface ScheduleTourProps {
  onScheduled?: () => void;
}

export default function ScheduleTour({
  onScheduled,
}: ScheduleTourProps = {}) {
  const {
    tours,
    setTours,
    rooms,
    blocks,
    setBlocks,
  } = useAppState();

  const {
    role,
    currentTcmId,
    tcms: storeTcms,
  } = useApp();

  // Main Calendar store
  const addCalendarEvent = useCalendar(
    (s) => s.addEvent,
  );

  const currentTcmName = storeTcms.find(
    (t) => t.id === currentTcmId,
  )?.name;

  const [step, setStep] =
    useState<1 | 2 | 3>(1);

  const [form, setForm] = useState({
    // Customer
    leadName: '',
    phone: '',
    bookingSource:
      'whatsapp' as BookingSource,

    // Qualification
    moveInDate: todayStr(),
    budget: '12000',
    workLocation: '',
    occupation: '',
    roomType: 'Single',
    decisionMaker:
      'self' as DecisionMaker,

    // Intent
    readyIn48h: false,
    exploring: false,
    comparing: false,
    needsFamily: false,
    willBookToday:
      'maybe' as WillBookToday,
    keyConcern: '',

    // Tour
    tourType:
      'physical' as TourType,
    zoneId: zones[0].id,
    propertyName: '',
    tourDate: todayStr(),
    tourTime: '',
    assignedTo: '',
  });

  // Indian mobile number validation
  const isValidPhone =
    /^[6-9]\d{9}$/.test(form.phone);

  // Auto assign logged-in TCM
  useEffect(() => {
    if (
      role === 'tcm' &&
      currentTcmName &&
      !form.assignedTo
    ) {
      const match = teamMembers.find(
        (m) =>
          m.role === 'tcm' &&
          m.name === currentTcmName,
      );

      if (match) {
        setForm((f) => ({
          ...f,
          assignedTo: match.id,
        }));
      }
    }
  }, [
    role,
    currentTcmName,
    form.assignedTo,
  ]);

  const qualification: TourQualification =
    useMemo(
      () => ({
        moveInDate:
          form.moveInDate,
        decisionMaker:
          form.decisionMaker,
        roomType:
          form.roomType,
        occupation:
          form.occupation,
        workLocation:
          form.workLocation,
        willBookToday:
          form.willBookToday,
        readyIn48h:
          form.readyIn48h,
        exploring:
          form.exploring,
        comparing:
          form.comparing,
        needsFamily:
          form.needsFamily,
        keyConcern:
          form.keyConcern,
      }),
      [form],
    );

  const {
    score,
    intent,
    reason,
  } = useMemo(
    () =>
      scoreTour(
        qualification,
        parseInt(form.budget) || 0,
      ),
    [
      qualification,
      form.budget,
    ],
  );

  const confirmationStrength =
    useMemo(
      () =>
        inferConfirmationStrength(
          qualification,
        ),
      [qualification],
    );

  const tcmsInZone =
    teamMembers.filter(
      (m) =>
        m.role === 'tcm' &&
        m.zoneId === form.zoneId,
    );

  const effectiveTcm =
    form.assignedTo
      ? teamMembers.find(
          (m) =>
            m.id ===
            form.assignedTo,
        )
      : autoAssignTcm(
          tours,
          form.zoneId,
          intent,
        );

  const takenSlots = useMemo(
    () =>
      effectiveTcm
        ? getTakenSlotsForDate(
            tours,
            effectiveTcm.id,
            form.tourDate,
          )
        : new Set<string>(),
    [
      tours,
      effectiveTcm,
      form.tourDate,
    ],
  );

  const canSubmit =
    Boolean(form.leadName) &&
    isValidPhone &&
    Boolean(form.propertyName) &&
    Boolean(form.tourTime) &&
    Boolean(effectiveTcm);

  const handleSubmit = () => {
    // Phone validation
    if (!isValidPhone) {
      toast.error(
        'Enter a valid 10-digit mobile number',
      );

      setStep(1);
      return;
    }

    if (!effectiveTcm) {
      toast.error(
        'No TCM available',
      );
      return;
    }

    if (!form.tourTime) {
      toast.error(
        'Pick a slot',
      );
      return;
    }

    const zone = zones.find(
      (z) =>
        z.id === form.zoneId,
    )!;

    const newTour: Tour = {
      id: `t${Date.now()}`,

      leadName:
        form.leadName,

      phone:
        form.phone,

      assignedTo:
        effectiveTcm.id,

      assignedToName:
        effectiveTcm.name,

      propertyName:
        form.propertyName,

      area:
        zone.area,

      zoneId:
        form.zoneId,

      tourDate:
        form.tourDate,

      tourTime:
        form.tourTime,

      bookingSource:
        form.bookingSource,

      scheduledBy:
        'm1',

      scheduledByName:
        'You',

      leadType:
        intent === 'hard'
          ? 'urgent'
          : 'future',

      status:
        'scheduled',

      showUp:
        null,

      outcome:
        null,

      remarks:
        '',

      budget:
        parseInt(
          form.budget,
        ) || 0,

      createdAt:
        new Date().toISOString(),

      tourType:
        form.tourType,

      intent,

      confidenceScore:
        score,

      confidenceReason:
        reason,

      confirmationStrength,

      qualification,

      tokenPaid:
        false,

      whyLost:
        null,
    };

    // =====================================
    // SAVE TO MYT TOUR STORE
    // =====================================

    setTours((prev) => [
      newTour,
      ...prev,
    ]);

    // =====================================
    // ADD TOUR TO MAIN CALENDAR
    // =====================================

    const startDateTime =
      new Date(
        `${form.tourDate}T${form.tourTime}:00`,
      );

    if (
      !Number.isNaN(
        startDateTime.getTime(),
      )
    ) {
      const endDateTime =
        new Date(
          startDateTime.getTime() +
            60 * 60 * 1000,
        );

      addCalendarEvent({
        title: `Tour · ${form.leadName}`,

        kind: 'tour',

        start:
          startDateTime.toISOString(),

        end:
          endDateTime.toISOString(),

        allDay:
          false,

        location:
          `${form.propertyName}, ${zone.area}`,

        description: [
          `Lead: ${form.leadName}`,
          `Phone: ${form.phone}`,
          `Property: ${form.propertyName}`,
          `Area: ${zone.area}`,
          `TCM: ${effectiveTcm.name}`,
          `Tour Type: ${form.tourType}`,
          `Intent: ${intent.toUpperCase()}`,
          `Confidence: ${score}%`,
          `Budget: ₹${
            parseInt(
              form.budget,
            ) || 0
          }`,
        ].join('\n'),

        tourId:
          newTour.id,

        externalSource:
          'local',

        reminder:
          15,
      });
    }

    // =====================================
    // AUTO ROOM BLOCK
    // =====================================

    const matchingProp =
      allProperties.find(
        (p) =>
          p.name ===
            form.propertyName &&
          p.zoneId ===
            form.zoneId,
      );

    if (matchingProp) {
      const tourWithProp = {
        ...newTour,
        propertyId:
          matchingProp.id,
      };

      const block =
        createBlockForTour(
          tourWithProp,
          rooms,
          blocks,
        );

      if (block) {
        setBlocks((prev) => [
          block,
          ...prev,
        ]);

        toast.success(
          `${intent.toUpperCase()} tour → ${
            effectiveTcm.name
          } · Room held ${
            intent === 'hard'
              ? '4h'
              : '1h'
          }`,
        );
      } else {
        toast.success(
          `${intent.toUpperCase()} tour assigned to ${effectiveTcm.name}`,
        );
      }
    } else {
      toast.success(
        `${intent.toUpperCase()} tour assigned to ${effectiveTcm.name}`,
      );
    }

    // =====================================
    // LOG TOUR EVENT
    // =====================================

    logTourEvent(
      newTour.id,
      'booked',
      `Booked by ${newTour.scheduledByName}`,
    ).catch(
      console.error,
    );

    // =====================================
    // SEND CONFIRMATION
    // =====================================

    sendTourMessage({
      tour: newTour,

      kind:
        'confirmation',

      channels: [
        'in_app',
        'whatsapp',
      ],
    }).catch((e) =>
      console.error(
        'confirmation send failed',
        e,
      ),
    );

    // =====================================
    // RESET FORM
    // =====================================

    setForm((f) => ({
      ...f,

      leadName:
        '',

      phone:
        '',

      propertyName:
        '',

      tourTime:
        '',

      keyConcern:
        '',
    }));

    setStep(1);

    onScheduled?.();
  };

  const select =
    'w-full h-10 bg-surface-2 border border-border rounded-md px-3 text-sm text-foreground';

  const labelCls =
    'text-muted-foreground text-[11px] uppercase tracking-wide';

  return (
    <div className="space-y-4 animate-slide-up max-w-3xl">

      {/* HEADER */}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-foreground">
            Schedule Tour
          </h1>

          <p className="text-xs text-muted-foreground">
            Smart form — every tour
            scored before send
          </p>
        </div>

        <div
          className={cn(
            'rounded-xl border p-3 min-w-[200px]',
            intentBg[intent],
          )}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3 w-3" />

            <span className="text-[10px] uppercase tracking-wide font-semibold">
              Live Score
            </span>
          </div>

          <div className="text-2xl font-bold tabular-nums">
            {score}

            <span className="text-xs text-muted-foreground">
              /100
            </span>
          </div>

          <ConfidenceBar
            score={score}
            intent={intent}
            showLabel={false}
            className="mt-1.5"
          />

          {reason.length >
            0 && (
            <p className="text-[10px] mt-1.5 leading-snug opacity-80">
              {reason.join(
                ' · ',
              )}
            </p>
          )}
        </div>
      </div>

      {/* STEPPER */}

      <div className="flex gap-1.5">
        {[1, 2, 3].map(
          (n) => (
            <button
              key={n}
              onClick={() =>
                setStep(
                  n as
                    | 1
                    | 2
                    | 3,
                )
              }
              className={cn(
                'flex-1 h-1.5 rounded-full transition-colors',

                step >= n
                  ? 'bg-primary'
                  : 'bg-surface-2',
              )}
            />
          ),
        )}
      </div>

      {/* ================================= */}
      {/* STEP 1 */}
      {/* ================================= */}

      {step === 1 && (
        <div className="glass-card p-4 md:p-5 space-y-4">

          <h3 className="font-heading font-semibold text-sm text-foreground">
            1. Customer &
            Qualification
          </h3>

          {/* NAME + PHONE */}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Lead Name
              </Label>

              <Input
                value={
                  form.leadName
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      leadName:
                        e.target
                          .value,
                    }),
                  )
                }
                className="bg-surface-2 border-border"
              />
            </div>

            {/* PHONE */}

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Phone
              </Label>

              <Input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={
                  form.phone
                }
                placeholder="10-digit mobile number"
                onChange={(e) => {
                  const digitsOnly =
                    e.target.value.replace(
                      /\D/g,
                      '',
                    );

                  setForm(
                    (f) => ({
                      ...f,

                      phone:
                        digitsOnly.slice(
                          0,
                          10,
                        ),
                    }),
                  );
                }}
                className={cn(
                  'bg-surface-2 border-border',

                  form.phone &&
                    !isValidPhone &&
                    'border-destructive focus-visible:ring-destructive',
                )}
              />

              {form.phone &&
                !isValidPhone && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Enter a valid
                    10-digit mobile
                    number starting
                    with 6, 7, 8,
                    or 9.
                  </p>
                )}
            </div>
          </div>

          {/* SOURCE + DECISION */}

          <div className="grid grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Source
              </Label>

              <select
                value={
                  form.bookingSource
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      bookingSource:
                        e.target
                          .value as BookingSource,
                    }),
                  )
                }
                className={
                  select
                }
              >
                <option value="ad">
                  Ad
                </option>

                <option value="referral">
                  Referral
                </option>

                <option value="organic">
                  Organic
                </option>

                <option value="whatsapp">
                  WhatsApp
                </option>

                <option value="call">
                  Call
                </option>

                <option value="walk-in">
                  Walk-in
                </option>
              </select>
            </div>

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Decision Maker
              </Label>

              <select
                value={
                  form.decisionMaker
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      decisionMaker:
                        e.target
                          .value as DecisionMaker,
                    }),
                  )
                }
                className={
                  select
                }
              >
                <option value="self">
                  Self
                </option>

                <option value="parent">
                  Parent
                </option>

                <option value="group">
                  Group
                </option>
              </select>
            </div>
          </div>

          {/* MOVE-IN + BUDGET */}

          <div className="grid grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Move-in Date
              </Label>

              <Input
                type="date"
                min={todayStr()}
                value={
                  form.moveInDate
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      moveInDate:
                        e.target
                          .value,
                    }),
                  )
                }
                className="bg-surface-2 border-border"
              />
            </div>

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Budget (₹/mo)
              </Label>

              <Input
                type="number"
                value={
                  form.budget
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      budget:
                        e.target
                          .value,
                    }),
                  )
                }
                className="bg-surface-2 border-border"
              />
            </div>
          </div>

          {/* WORK */}

          <div className="grid grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Work / College
              </Label>

              <Input
                value={
                  form.occupation
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      occupation:
                        e.target
                          .value,
                    }),
                  )
                }
                placeholder="e.g. Infosys"
                className="bg-surface-2 border-border"
              />
            </div>

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Work Location
              </Label>

              <Input
                value={
                  form.workLocation
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      workLocation:
                        e.target
                          .value,
                    }),
                  )
                }
                placeholder="e.g. Bellandur"
                className="bg-surface-2 border-border"
              />
            </div>
          </div>

          {/* ROOM TYPE */}

          <div>
            <Label
              className={
                labelCls
              }
            >
              Room Type
            </Label>

            <select
              value={
                form.roomType
              }
              onChange={(e) =>
                setForm(
                  (f) => ({
                    ...f,

                    roomType:
                      e.target
                        .value,
                  }),
                )
              }
              className={
                select
              }
            >
              {roomTypes.map(
                (r) => (
                  <option
                    key={r}
                    value={r}
                  >
                    {r}
                  </option>
                ),
              )}
            </select>
          </div>

          <Button
            onClick={() => {
              if (
                !isValidPhone
              ) {
                toast.error(
                  'Enter a valid 10-digit mobile number',
                );

                return;
              }

              setStep(2);
            }}
            disabled={
              !form.leadName ||
              !isValidPhone
            }
            className="w-full"
          >
            Next: Intent →
          </Button>
        </div>
      )}

      {/* ================================= */}
      {/* STEP 2 */}
      {/* ================================= */}

      {step === 2 && (
        <div className="glass-card p-4 md:p-5 space-y-4">

          <h3 className="font-heading font-semibold text-sm text-foreground">
            2. Intent Signals
          </h3>

          <div className="space-y-2">
            {[
              [
                'readyIn48h',
                'Ready to finalize within 48 hours',
                'positive',
              ],

              [
                'exploring',
                'Only exploring',
                'negative',
              ],

              [
                'comparing',
                'Comparing options',
                'negative',
              ],

              [
                'needsFamily',
                'Needs family approval',
                'negative',
              ],
            ].map(
              ([
                key,
                label,
                kind,
              ]) => (
                <label
                  key={key}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border bg-surface-2/40 cursor-pointer hover:bg-surface-2 transition-colors',

                    form[
                      key as keyof typeof form
                    ] &&
                      (kind ===
                      'positive'
                        ? 'border-role-tcm/40 bg-role-tcm/5'
                        : 'border-amber/40 bg-amber/5'),
                  )}
                >
                  <Checkbox
                    checked={
                      form[
                        key as keyof typeof form
                      ] as boolean
                    }
                    onCheckedChange={(
                      v,
                    ) =>
                      setForm(
                        (f) => ({
                          ...f,

                          [key]:
                            v ===
                            true,
                        }),
                      )
                    }
                  />

                  <span className="text-sm text-foreground flex-1">
                    {
                      label as string
                    }
                  </span>

                  <span
                    className={cn(
                      'text-[10px] font-medium',

                      kind ===
                        'positive'
                        ? 'text-role-tcm'
                        : 'text-amber-foreground',
                    )}
                  >
                    {kind ===
                    'positive'
                      ? '+'
                      : '−'}
                  </span>
                </label>
              ),
            )}
          </div>

          <div className="pt-2 border-t border-border">

            <Label className="text-foreground text-sm font-semibold">
              If everything
              matches, will you
              book today?
            </Label>

            <div className="grid grid-cols-3 gap-2 mt-2">

              {(
                [
                  'yes',
                  'maybe',
                  'no',
                ] as WillBookToday[]
              ).map(
                (opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm(
                        (f) => ({
                          ...f,

                          willBookToday:
                            opt,
                        }),
                      )
                    }
                    className={cn(
                      'h-11 rounded-lg border-2 text-sm font-medium uppercase tracking-wide transition-all',

                      form.willBookToday ===
                        opt
                        ? opt ===
                          'yes'
                          ? 'border-role-tcm bg-role-tcm/15 text-role-tcm'
                          : opt ===
                              'no'
                            ? 'border-danger bg-danger/15 text-danger'
                            : 'border-role-hr bg-role-hr/15 text-role-hr'
                        : 'border-border bg-surface-2 text-muted-foreground hover:bg-surface-3',
                    )}
                  >
                    {opt}
                  </button>
                ),
              )}
            </div>
          </div>

          <div>
            <Label
              className={
                labelCls
              }
            >
              Key Concern
              (optional)
            </Label>

            <Input
              value={
                form.keyConcern
              }
              onChange={(e) =>
                setForm(
                  (f) => ({
                    ...f,

                    keyConcern:
                      e.target
                        .value,
                  }),
                )
              }
              placeholder="e.g. food quality, distance"
              className="bg-surface-2 border-border"
            />
          </div>

          <div className="flex gap-2">

            <Button
              variant="outline"
              onClick={() =>
                setStep(1)
              }
              className="flex-1"
            >
              ← Back
            </Button>

            <Button
              onClick={() =>
                setStep(3)
              }
              className="flex-1"
            >
              Next: Slot →
            </Button>
          </div>
        </div>
      )}

      {/* ================================= */}
      {/* STEP 3 */}
      {/* ================================= */}

      {step === 3 && (
        <div className="glass-card p-4 md:p-5 space-y-4">

          <h3 className="font-heading font-semibold text-sm text-foreground">
            3. Tour Type &
            Slot
          </h3>

          {/* TOUR TYPE */}

          <div>
            <Label
              className={
                labelCls
              }
            >
              Tour Type
            </Label>

            <div className="grid grid-cols-3 gap-2 mt-1.5">

              {(
                [
                  [
                    'physical',

                    <Building2
                      key="p"
                      className="h-4 w-4"
                    />,

                    'Physical',
                  ],

                  [
                    'virtual',

                    <Video
                      key="v"
                      className="h-4 w-4"
                    />,

                    'Virtual',
                  ],

                  [
                    'pre-book-pitch',

                    <Briefcase
                      key="b"
                      className="h-4 w-4"
                    />,

                    'Pre-book',
                  ],
                ] as const
              ).map(
                ([
                  val,
                  icon,
                  label,
                ]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      setForm(
                        (f) => ({
                          ...f,

                          tourType:
                            val as TourType,
                        }),
                      )
                    }
                    className={cn(
                      'h-14 rounded-lg border-2 text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all',

                      form.tourType ===
                        val
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-surface-2 text-muted-foreground',
                    )}
                  >
                    {icon}

                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* ZONE + PROPERTY */}

          <div className="grid grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Zone
              </Label>

              <select
                value={
                  form.zoneId
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      zoneId:
                        e.target
                          .value,

                      assignedTo:
                        '',
                    }),
                  )
                }
                className={
                  select
                }
              >
                {zones.map(
                  (z) => (
                    <option
                      key={z.id}
                      value={z.id}
                    >
                      {z.name}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Property
              </Label>

              <select
                value={
                  form.propertyName
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      propertyName:
                        e.target
                          .value,
                    }),
                  )
                }
                className={
                  select
                }
              >
                <option value="">
                  Select
                  property…
                </option>

                {allProperties
                  .filter(
                    (p) =>
                      p.zoneId ===
                      form.zoneId,
                  )
                  .map(
                    (p) => (
                      <option
                        key={p.id}
                        value={
                          p.name
                        }
                      >
                        {p.name} · ₹
                        {(
                          p.basePrice /
                          1000
                        ).toFixed(
                          0,
                        )}
                        k
                      </option>
                    ),
                  )}
              </select>
            </div>
          </div>

          {/* DATE + TCM */}

          <div className="grid grid-cols-2 gap-3">

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Date
              </Label>

              <Input
                type="date"
                min={todayStr()}
                max={in7days()}
                value={
                  form.tourDate
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      tourDate:
                        e.target
                          .value,

                      tourTime:
                        '',
                    }),
                  )
                }
                className="bg-surface-2 border-border"
              />
            </div>

            <div>
              <Label
                className={
                  labelCls
                }
              >
                Assign TCM
              </Label>

              <select
                value={
                  form.assignedTo
                }
                onChange={(e) =>
                  setForm(
                    (f) => ({
                      ...f,

                      assignedTo:
                        e.target
                          .value,

                      tourTime:
                        '',
                    }),
                  )
                }
                className={
                  select
                }
              >
                <option value="">
                  ⚡ Auto-assign (
                  {effectiveTcm
                    ?.name ??
                    '—'}
                  )
                </option>

                {tcmsInZone.map(
                  (m) => (
                    <option
                      key={m.id}
                      value={m.id}
                    >
                      {m.name}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          {/* SLOT */}

          <div>
            <Label
              className={
                labelCls
              }
            >
              Pick Slot

              {effectiveTcm && (
                <span className="ml-2 normal-case text-foreground/60">
                  (
                  {
                    effectiveTcm.name
                  }
                  )
                </span>
              )}
            </Label>

            <div className="mt-1.5">

              <SlotPicker
                date={
                  form.tourDate
                }
                selected={
                  form.tourTime
                }
                onSelect={(t) =>
                  setForm(
                    (f) => ({
                      ...f,

                      tourTime:
                        t,
                    }),
                  )
                }
                takenSlots={
                  takenSlots
                }
                recommendEarly={
                  intent ===
                  'hard'
                }
              />
            </div>
          </div>

          {/* SUBMIT */}

          <div className="flex gap-2 pt-2">

            <Button
              variant="outline"
              onClick={() =>
                setStep(2)
              }
              className="flex-1"
            >
              ← Back
            </Button>

            <Button
              onClick={
                handleSubmit
              }
              disabled={
                !canSubmit
              }
              className="flex-[2]"
            >
              Schedule{' '}
              {intent.toUpperCase()}{' '}
              Tour
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}