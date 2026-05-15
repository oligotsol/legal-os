"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  updateFirmIdentity,
  updateBranding,
  uploadLogo,
} from "./actions";

interface FirmIdentity {
  legal_name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
}

interface Branding {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string;
}

interface FirmSettingsFormProps {
  identity: FirmIdentity;
  branding: Branding;
}

export function FirmSettingsForm({ identity, branding }: FirmSettingsFormProps) {
  return (
    <div className="space-y-8">
      <IdentitySection initial={identity} />
      <BrandingSection initial={branding} />
      <LetterheadPreview identity={identity} branding={branding} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Firm identity section
// ---------------------------------------------------------------------------

function IdentitySection({ initial }: { initial: FirmIdentity }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateFirmIdentity(formData);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firm Identity</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Legal name"
            name="legal_name"
            defaultValue={initial.legal_name}
            placeholder="Legacy First Law, PLLC"
            full
          />
          <Field
            label="Street address"
            name="address"
            defaultValue={initial.address}
            placeholder="9110 N Loop 1604 W, Suite 104, San Antonio, TX"
            full
          />
          <Field label="Phone" name="phone" defaultValue={initial.phone} placeholder="(210) 939-6881" />
          <Field label="Fax" name="fax" defaultValue={initial.fax} placeholder="(855) 785-7597" />
          <Field label="Email" name="email" defaultValue={initial.email} type="email" placeholder="garrison@legacyfirstlaw.com" />
          <Field label="Website" name="website" defaultValue={initial.website} placeholder="legacyfirstlaw.com" />

          <div className="col-span-full mt-2 flex items-center justify-between">
            <div className="text-xs">
              {error && <span className="text-destructive">{error}</span>}
              {saved && <span className="text-emerald-600">Saved.</span>}
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save identity"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Branding section
// ---------------------------------------------------------------------------

const FONT_OPTIONS = [
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (serif)" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Garamond, 'Times New Roman', serif", label: "Garamond" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: "Helvetica Neue" },
  { value: "'Inter', system-ui, sans-serif", label: "Inter (sans)" },
];

function BrandingSection({ initial }: { initial: Branding }) {
  const [isPending, startTransition] = useTransition();
  const [isUploading, startUpload] = useTransition();
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logo_url);
  const [primary, setPrimary] = useState(initial.primary_color);
  const [secondary, setSecondary] = useState(initial.secondary_color);
  const [font, setFont] = useState(initial.font_family);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startUpload(async () => {
      try {
        const url = await uploadLogo(fd);
        setLogoUrl(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    });
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("logo_url", logoUrl ?? "");
    fd.set("primary_color", primary);
    fd.set("secondary_color", secondary);
    fd.set("font_family", font);
    startTransition(async () => {
      try {
        await updateBranding(fd);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm">Logo</Label>
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-xs text-muted-foreground overflow-hidden"
              aria-label="logo preview"
            >
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="logo" className="max-h-16 max-w-16 object-contain" />
              ) : (
                "No logo"
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={() => fileRef.current?.click()}
              >
                {isUploading ? "Uploading..." : "Upload logo"}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLogoUrl(null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ColorField label="Primary color" value={primary} onChange={setPrimary} />
          <ColorField label="Secondary color" value={secondary} onChange={setSecondary} />
        </div>

        <div>
          <Label className="mb-2 block text-sm">Font family</Label>
          <select
            value={font}
            onChange={(e) => setFont(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs">
            {error && <span className="text-destructive">{error}</span>}
            {saved && <span className="text-emerald-600">Saved.</span>}
          </div>
          <Button type="button" disabled={isPending} onClick={handleSave}>
            {isPending ? "Saving..." : "Save branding"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Letterhead preview
// ---------------------------------------------------------------------------

function LetterheadPreview({
  identity,
  branding,
}: {
  identity: FirmIdentity;
  branding: Branding;
}) {
  const displayName = (identity.legal_name || "Your Firm Name")
    .replace(/,?\s*(PLLC|LLC|PC|LLP|PA)$/i, "")
    .toUpperCase();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Letterhead preview</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="rounded-md border bg-white p-6 text-center"
          style={
            {
              fontFamily: branding.font_family,
              color: branding.primary_color,
            } as React.CSSProperties
          }
        >
          {branding.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={branding.logo_url}
              alt="logo"
              className="mx-auto mb-3 max-h-16"
            />
          )}
          <p
            className="text-lg font-semibold"
            style={{ letterSpacing: "0.4em" }}
          >
            {displayName}
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: branding.secondary_color }}
          >
            {identity.address || "Street address"}
          </p>
          <p
            className="text-xs"
            style={{ color: branding.secondary_color }}
          >
            Phone: {identity.phone || "(000) 000-0000"} | Fax:{" "}
            {identity.fax || "(000) 000-0000"} |{" "}
            {identity.website || "yourfirm.com"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Field primitive
// ---------------------------------------------------------------------------

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  full = false,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <Label htmlFor={name} className="mb-1 block text-sm">
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-1 block text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
      </div>
    </div>
  );
}
