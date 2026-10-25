/**
 * One surface's card on the `/feedback` index. Presentational and in
 * `src/components/` because the route composes two features (site and club)
 * that must not import each other.
 */
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

export interface FeedbackSurfaceCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  to: "/feedback/club" | "/feedback/site/triage";
  cta: string;
  badges: string[];
}

export function FeedbackSurfaceCard({
  icon: Icon,
  title,
  description,
  to,
  cta,
  badges,
}: FeedbackSurfaceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5" aria-hidden="true" />
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {badges.length > 0 ? (
        <CardContent className="flex flex-wrap gap-2">
          {badges.map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
        </CardContent>
      ) : null}
      <CardFooter>
        <Button asChild>
          <Link to={to}>{cta}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
