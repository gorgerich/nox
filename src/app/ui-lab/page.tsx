"use client";

// Public discovery page (no auth): renders a curated set of Astryx components
// themed with neutralTheme so we can see how the design system actually looks
// inside this app before adopting any of it into real screens. Safe to delete
// once the audit is done.

import { useState } from "react";
import { Search, Bell, MessageCircle, UserPlus } from "lucide-react";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/theme-neutral/theme.css";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl } from "@astryxdesign/core/SegmentedControl";
import { SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.55, marginBottom: 12 }}>
        {title}
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>
    </section>
  );
}

export default function UiLabPage() {
  const [folder, setFolder] = useState("all");
  const [notify, setNotify] = useState(true);
  const [name, setName] = useState("");

  return (
    <Theme theme={neutralTheme}>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 64px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Astryx UI Lab</h1>
        <p style={{ opacity: 0.6, marginBottom: 32 }}>
          Живой рендер astryx-компонентов в этом приложении. Смотрим что подходит nox.
        </p>

        <Row title="Buttons">
          <Button label="Primary" variant="primary" onClick={() => {}} />
          <Button label="Secondary" variant="secondary" onClick={() => {}} />
          <Button label="Ghost" variant="ghost" onClick={() => {}} />
          <Button label="Loading" variant="primary" isLoading onClick={() => {}} />
          <Button label="Icon" variant="primary" icon={<UserPlus size={16} />} onClick={() => {}} />
        </Row>

        <Row title="Segmented control (папки чатов)">
          <SegmentedControl label="Папки" value={folder} onChange={setFolder}>
            <SegmentedControlItem value="all" label="Все" />
            <SegmentedControlItem value="unread" label="Непрочитанные" />
            <SegmentedControlItem value="groups" label="Группы" />
          </SegmentedControl>
        </Row>

        <Row title="Inputs">
          <div style={{ minWidth: 260 }}>
            <TextInput label="Имя" placeholder="Введите имя" value={name} onChange={setName} startIcon={<Search size={16} />} />
          </div>
          <Switch label="Уведомления" value={notify} onChange={(checked) => setNotify(checked)} labelIcon={<Bell size={16} />} />
        </Row>

        <Row title="Avatars & badges">
          <Avatar name="Лия" />
          <Avatar name="Гриша" />
          <Badge label="12" />
          <Badge label="3" />
          <Badge label="Онлайн" />
        </Row>

        <Row title="Empty state">
          <div style={{ width: "100%" }}>
            <EmptyState
              title="Пока нет чатов"
              description="Начните новый разговор — он появится здесь."
              icon={<MessageCircle size={28} />}
              actions={<Button label="Новый чат" variant="primary" onClick={() => {}} />}
            />
          </div>
        </Row>
      </main>
    </Theme>
  );
}
