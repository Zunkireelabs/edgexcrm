"use client";

interface GreetingHeaderProps {
  userName: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function GreetingHeader({ userName }: GreetingHeaderProps) {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-foreground mb-1">
        {getGreeting()}, {userName}
      </h1>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {dateStr}
      </p>
    </div>
  );
}
