"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Board, BoardCard, BoardList } from "@/lib/board";

type BoardViewProps = {
  initialBoard: Board;
};

type RequestOptions = {
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function orderedLists(lists: BoardList[]) {
  return lists
    .map((list, index) => ({ list, index }))
    .sort((a, b) => {
      const aGroup = a.list.kind === "backlog" ? 1 : 0;
      const bGroup = b.list.kind === "backlog" ? 1 : 0;
      return aGroup - bGroup || a.index - b.index;
    })
    .map(({ list }) => list);
}

function dateInputValue(due: string | null) {
  return due ? due.slice(0, 10) : "";
}

function isOverdue(card: BoardCard) {
  if (!card.due || card.list === "done") return false;
  const today = new Date();
  const localDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return card.due.slice(0, 10) < localDate;
}

export function BoardView({ initialBoard }: BoardViewProps) {
  const [board, setBoard] = useState(initialBoard);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lists = useMemo(() => orderedLists(board.lists), [board.lists]);
  const editingCard = board.cards.find((card) => card.id === editingId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/board", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setBoard((await response.json()) as Board);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh board");
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  const mutate = useCallback(
    async (path: string, options: RequestOptions) => {
      setBusy(true);
      setError(null);
      let requestError: Error | null = null;
      try {
        const response = await fetch(path, {
          method: options.method,
          headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        if (!response.ok) throw new Error(await responseError(response));
      } catch (mutationError) {
        requestError = mutationError instanceof Error ? mutationError : new Error("Request failed");
        setError(requestError.message);
      }
      await refresh();
      setBusy(false);
      if (requestError) throw requestError;
    },
    [refresh],
  );

  async function createCard(list: string, title: string) {
    if (!title.trim()) return;
    try {
      await mutate("/api/board/cards", {
        method: "POST",
        body: { title: title.trim(), list },
      });
      setAddingTo(null);
    } catch {
      return;
    }
  }

  async function moveCard(cardId: string, list: string) {
    const card = board.cards.find((item) => item.id === cardId);
    setDraggedId(null);
    setDragTarget(null);
    if (!card || card.list === list) return;
    try {
      await mutate(`/api/board/cards/${cardId}`, { method: "PATCH", body: { list } });
    } catch {
      return;
    }
  }

  return (
    <section className="board-page" aria-busy={busy}>
      <div className="board-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Board</h1>
        </div>
        <p className="board-hint">Drag cards between lists, or open a card to move it.</p>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      <div className="board-scroll" aria-label="Kanban board">
        <div className="board-columns">
          {lists.map((list) => {
            const cards = board.cards
              .filter((card) => card.list === list.id)
              .sort((a, b) => a.pos - b.pos || a.createdAt.localeCompare(b.createdAt));
            return (
              <section
                className={`board-column ${list.kind === "backlog" ? "board-column-backlog" : ""}`}
                data-drag-target={dragTarget === list.id ? "true" : "false"}
                key={list.id}
                onDragEnter={() => setDragTarget(list.id)}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragTarget(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const cardId = event.dataTransfer.getData("text/plain") || draggedId;
                  if (cardId) void moveCard(cardId, list.id);
                }}
              >
                <header className="column-header">
                  <div>
                    <span className="column-indicator" aria-hidden="true" />
                    <h2>{list.name}</h2>
                  </div>
                  <span className="card-count" aria-label={`${cards.length} cards`}>{cards.length}</span>
                </header>

                <div className="card-stack">
                  {cards.length === 0 && addingTo !== list.id ? (
                    <p className="empty-list">No cards yet</p>
                  ) : null}
                  {cards.map((card) => (
                    <button
                      className="board-card"
                      draggable
                      key={card.id}
                      onClick={() => setEditingId(card.id)}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragTarget(null);
                      }}
                      onDragStart={(event) => {
                        setDraggedId(card.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", card.id);
                      }}
                      type="button"
                    >
                      <span className="card-title">{card.title}</span>
                      {card.desc ? <span className="card-description">{card.desc}</span> : null}
                      {card.due ? (
                        <span className={`due-date ${isOverdue(card) ? "due-overdue" : ""}`}>
                          {isOverdue(card) ? <span className="overdue-dot" aria-hidden="true" /> : null}
                          {isOverdue(card) ? "Overdue " : "Due "}
                          {dateInputValue(card.due)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                {addingTo === list.id ? (
                  <InlineCardForm
                    disabled={busy}
                    onCancel={() => setAddingTo(null)}
                    onCreate={(title) => void createCard(list.id, title)}
                  />
                ) : (
                  <button className="add-card-button" onClick={() => setAddingTo(list.id)} type="button">
                    <span aria-hidden="true">+</span>
                    Add card
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {editingCard ? (
        <CardPanel
          board={board}
          busy={busy}
          card={editingCard}
          onClose={() => setEditingId(null)}
          onDelete={async () => {
            await mutate(`/api/board/cards/${editingCard.id}`, { method: "DELETE" });
            setEditingId(null);
          }}
          onSave={async (updates) => {
            await mutate(`/api/board/cards/${editingCard.id}`, { method: "PATCH", body: updates });
            setEditingId(null);
          }}
        />
      ) : null}
    </section>
  );
}

function InlineCardForm({
  disabled,
  onCancel,
  onCreate,
}: {
  disabled: boolean;
  onCancel: () => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && !event.nativeEvent.isComposing && title.trim()) {
      event.preventDefault();
      onCreate(title);
    }
  }

  return (
    <div className="inline-card-form">
      <input
        aria-label="Card title"
        autoFocus
        disabled={disabled}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What needs doing?"
        value={title}
      />
      <p><kbd>Enter</kbd> save <kbd>Esc</kbd> cancel</p>
    </div>
  );
}

function CardPanel({
  board,
  busy,
  card,
  onClose,
  onDelete,
  onSave,
}: {
  board: Board;
  busy: boolean;
  card: BoardCard;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (updates: Pick<BoardCard, "title" | "desc" | "list" | "due">) => Promise<void>;
}) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.desc);
  const [list, setList] = useState(card.list);
  const [due, setDue] = useState(dateInputValue(card.due));
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await onSave({ title: title.trim(), desc, list, due: due || null });
    } catch {
      return;
    }
  }

  return (
    <div className="panel-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="card-panel" role="dialog" aria-modal="true" aria-labelledby="card-panel-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Card details</p>
            <h2 id="card-panel-title">Edit card</h2>
          </div>
          <button className="icon-button" aria-label="Close card details" onClick={onClose} type="button">×</button>
        </div>

        <form className="card-form" onSubmit={submit}>
          <label>
            Title
            <input autoFocus onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>
          <label>
            Description
            <textarea
              onChange={(event) => setDesc(event.target.value)}
              placeholder="Add useful context"
              rows={7}
              value={desc}
            />
          </label>
          <div className="form-row">
            <label>
              List
              <select onChange={(event) => setList(event.target.value)} value={list}>
                {orderedLists(board.lists).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input onChange={(event) => setDue(event.target.value)} type="date" value={due} />
            </label>
          </div>

          <div className="panel-actions">
            {confirmDelete ? (
              <div className="delete-confirm">
                <span>Delete this card?</span>
                <button disabled={busy} onClick={() => void onDelete()} type="button">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
              </div>
            ) : (
              <button className="delete-button" onClick={() => setConfirmDelete(true)} type="button">Delete</button>
            )}
            <button className="save-button" disabled={busy || !title.trim()} type="submit">
              {busy ? "Saving" : "Save changes"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
