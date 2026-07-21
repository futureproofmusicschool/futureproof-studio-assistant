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

const CARD_TRANSFER_TYPE = "application/x-board-card";
const LIST_TRANSFER_TYPE = "application/x-board-list";

type ListDropTarget = {
  id: string;
  edge: "left" | "right";
};

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function hasTransferType(dataTransfer: DataTransfer, type: string) {
  return Array.from(dataTransfer.types).includes(type);
}

function reorderAtTarget(lists: BoardList[], draggedId: string, targetId: string) {
  const fromIndex = lists.findIndex((list) => list.id === draggedId);
  const targetIndex = lists.findIndex((list) => list.id === targetId);
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return lists;

  const reordered = [...lists];
  const [dragged] = reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, dragged);
  return reordered;
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
  const [draggedListId, setDraggedListId] = useState<string | null>(null);
  const [listDropTarget, setListDropTarget] = useState<ListDropTarget | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lists = useMemo(() => board.lists, [board.lists]);
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

  useEffect(() => {
    if (!reorderError) return;
    const timeout = window.setTimeout(() => setReorderError(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [reorderError]);

  useEffect(() => {
    if (!openListMenuId) return;
    function closeListMenu(event: PointerEvent) {
      if (!(event.target as HTMLElement).closest(".column-menu")) setOpenListMenuId(null);
    }
    document.addEventListener("pointerdown", closeListMenu);
    return () => document.removeEventListener("pointerdown", closeListMenu);
  }, [openListMenuId]);

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

  async function createList(name: string) {
    if (!name.trim()) return;
    try {
      await mutate("/api/board/lists", { method: "POST", body: { name: name.trim() } });
      setAddingList(false);
    } catch {
      return;
    }
  }

  async function renameList(listId: string, name: string) {
    if (!name.trim()) return;
    try {
      await mutate(`/api/board/lists/${listId}`, {
        method: "PATCH",
        body: { name: name.trim() },
      });
      setRenamingListId(null);
    } catch {
      return;
    }
  }

  async function deleteList(list: BoardList, cardCount: number) {
    if (board.lists.length === 1) return;
    const message = cardCount > 0
      ? `Delete the list '${list.name}' and its ${cardCount} ${cardCount === 1 ? "card" : "cards"}? This cannot be undone.`
      : `Delete the empty list '${list.name}'? This cannot be undone.`;
    if (!window.confirm(message)) return;

    setOpenListMenuId(null);
    try {
      await mutate(`/api/board/lists/${list.id}`, { method: "DELETE" });
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

  async function persistListOrder(nextLists: BoardList[]) {
    setBoard((current) => ({ ...current, lists: nextLists }));
    setBusy(true);
    setReorderError(null);

    let requestError: Error | null = null;
    try {
      const response = await fetch("/api/board/lists/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: nextLists.map((list) => list.id) }),
      });
      if (!response.ok) throw new Error(await responseError(response));
    } catch (mutationError) {
      requestError = mutationError instanceof Error ? mutationError : new Error("Unable to save list order");
    }

    await refresh();
    setBusy(false);
    if (requestError) setReorderError(`List order was not saved. ${requestError.message}`);
  }

  function listDropEdge(targetId: string, sourceId: string): ListDropTarget["edge"] {
    const sourceIndex = board.lists.findIndex((list) => list.id === sourceId);
    const targetIndex = board.lists.findIndex((list) => list.id === targetId);
    return targetIndex > sourceIndex ? "right" : "left";
  }

  function moveListByOffset(listId: string, offset: -1 | 1) {
    const fromIndex = board.lists.findIndex((list) => list.id === listId);
    const toIndex = fromIndex + offset;
    if (busy || fromIndex === -1 || toIndex < 0 || toIndex >= board.lists.length) return;

    const reordered = [...board.lists];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    void persistListOrder(reordered);
  }

  return (
    <section className="board-page" aria-busy={busy}>
      <div className="board-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Board</h1>
        </div>
        <div className="board-heading-notes">
          {reorderError ? <p className="reorder-error-note" role="status">{reorderError}</p> : null}
          <p className="board-hint">Drag cards between lists. Drag column headers to reorder.</p>
        </div>
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
                data-list-drop-edge={listDropTarget?.id === list.id ? listDropTarget.edge : undefined}
                key={list.id}
                onDragEnter={(event) => {
                  if (hasTransferType(event.dataTransfer, CARD_TRANSFER_TYPE)) {
                    setDragTarget(list.id);
                  } else if (hasTransferType(event.dataTransfer, LIST_TRANSFER_TYPE)) {
                    const sourceId = draggedListId;
                    if (sourceId && sourceId !== list.id) {
                      setListDropTarget({ id: list.id, edge: listDropEdge(list.id, sourceId) });
                    } else {
                      setListDropTarget(null);
                    }
                  }
                }}
                onDragOver={(event) => {
                  if (hasTransferType(event.dataTransfer, CARD_TRANSFER_TYPE)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragTarget(list.id);
                  } else if (hasTransferType(event.dataTransfer, LIST_TRANSFER_TYPE)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const sourceId = draggedListId;
                    if (sourceId && sourceId !== list.id) {
                      setListDropTarget({ id: list.id, edge: listDropEdge(list.id, sourceId) });
                    } else {
                      setListDropTarget(null);
                    }
                  }
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragTarget(null);
                    setListDropTarget(null);
                  }
                }}
                onDrop={(event) => {
                  if (hasTransferType(event.dataTransfer, LIST_TRANSFER_TYPE)) {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData(LIST_TRANSFER_TYPE) || draggedListId;
                    setDraggedListId(null);
                    setListDropTarget(null);
                    if (sourceId) {
                      const reordered = reorderAtTarget(board.lists, sourceId, list.id);
                      if (reordered !== board.lists) void persistListOrder(reordered);
                    }
                  } else if (hasTransferType(event.dataTransfer, CARD_TRANSFER_TYPE)) {
                    event.preventDefault();
                    const cardId = event.dataTransfer.getData(CARD_TRANSFER_TYPE) || draggedId;
                    if (cardId) void moveCard(cardId, list.id);
                  }
                }}
              >
                <header
                  className="column-header"
                  draggable={!busy}
                  onDragEnd={() => {
                    setDraggedListId(null);
                    setListDropTarget(null);
                  }}
                  onDragStart={(event) => {
                    if ((event.target as HTMLElement).closest(".column-move-button, .column-menu, .column-title-input")) {
                      event.preventDefault();
                      return;
                    }
                    setDraggedListId(list.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(LIST_TRANSFER_TYPE, list.id);
                  }}
                >
                  <div className="column-title">
                    <span className="column-indicator" aria-hidden="true" />
                    {renamingListId === list.id ? (
                      <InlineListNameInput
                        disabled={busy}
                        initialName={list.name}
                        label={`Rename ${list.name} list`}
                        onCancel={() => setRenamingListId(null)}
                        onSave={(name) => void renameList(list.id, name)}
                      />
                    ) : (
                      <h2>{list.name}</h2>
                    )}
                  </div>
                  <div className="column-header-actions">
                    <span className="card-count" aria-label={`${cards.length} cards`}>{cards.length}</span>
                    <div className="column-move-controls" aria-label={`Move ${list.name} list`}>
                      <button
                        aria-label={`Move ${list.name} left`}
                        className="column-move-button"
                        disabled={busy || board.lists[0]?.id === list.id}
                        draggable={false}
                        onClick={() => moveListByOffset(list.id, -1)}
                        type="button"
                      >
                        ←
                      </button>
                      <button
                        aria-label={`Move ${list.name} right`}
                        className="column-move-button"
                        disabled={busy || board.lists.at(-1)?.id === list.id}
                        draggable={false}
                        onClick={() => moveListByOffset(list.id, 1)}
                        type="button"
                      >
                        →
                      </button>
                    </div>
                    <div className="column-menu" data-list-menu={list.id}>
                      <button
                        aria-expanded={openListMenuId === list.id}
                        aria-haspopup="menu"
                        aria-label={`Actions for ${list.name}`}
                        className="column-menu-button"
                        disabled={busy}
                        draggable={false}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenListMenuId((current) => current === list.id ? null : list.id);
                        }}
                        onDragStart={(event) => event.preventDefault()}
                        onPointerDown={(event) => event.stopPropagation()}
                        type="button"
                      >
                        <span aria-hidden="true">•••</span>
                      </button>
                      {openListMenuId === list.id ? (
                        <div className="column-menu-popover" role="menu">
                          <button
                            onClick={() => {
                              setRenamingListId(list.id);
                              setOpenListMenuId(null);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="column-menu-delete"
                            disabled={board.lists.length === 1}
                            onClick={() => void deleteList(list, cards.length)}
                            role="menuitem"
                            title={board.lists.length === 1 ? "A board must keep at least one list" : undefined}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
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
                        event.dataTransfer.setData(CARD_TRANSFER_TYPE, card.id);
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
          <section className={`add-list-column ${addingList ? "add-list-column-active" : ""}`}>
            {addingList ? (
              <InlineListNameInput
                disabled={busy}
                label="New list name"
                onCancel={() => setAddingList(false)}
                onSave={(name) => void createList(name)}
                placeholder="List name"
              />
            ) : (
              <button
                className="add-list-button"
                disabled={busy}
                onClick={() => setAddingList(true)}
                type="button"
              >
                <span aria-hidden="true">+</span>
                Add list
              </button>
            )}
          </section>
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

function InlineListNameInput({
  disabled,
  initialName = "",
  label,
  onCancel,
  onSave,
  placeholder,
}: {
  disabled: boolean;
  initialName?: string;
  label: string;
  onCancel: () => void;
  onSave: (name: string) => void;
  placeholder?: string;
}) {
  const [name, setName] = useState(initialName);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) {
      event.preventDefault();
      onSave(name);
    }
  }

  return (
    <input
      aria-label={label}
      autoFocus
      className="column-title-input"
      disabled={disabled}
      draggable={false}
      onChange={(event) => setName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      placeholder={placeholder}
      value={name}
    />
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
                {board.lists.map((item) => (
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
