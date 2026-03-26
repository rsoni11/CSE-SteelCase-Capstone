import { useState, useEffect } from 'react';

// Custom hook for undo/redo move history
export function useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef) {
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const syncEntryToPosition = (entry, position) => {
    if (!entry) return;

    entry.mesh.position.copy(position);

    if (entry.body) {
      entry.body.position.set(position.x, position.y, position.z);
      entry.body.velocity.set(0, 0, 0);
      entry.body.angularVelocity.set(0, 0, 0);
      entry.body.wakeUp();
    }
  };

  const saveToHistory = (mesh, oldPos, newPos) => {
    const move = {
      meshId: mesh.uuid,
      oldPosition: oldPos.clone(),
      newPosition: newPos.clone()
    };

    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(move);
      return newHistory;
    });

    setHistoryIndex((prev) => prev + 1);
  };

  const undo = () => {
    if (historyIndex < 0 || historyIndex >= history.length) return;

    const move = history[historyIndex];
    if (!move) return;

    const entry = cargoRegistryRef.current.find((e) => e.mesh.uuid === move.meshId);
    if (entry) syncEntryToPosition(entry, move.oldPosition);

    setHistoryIndex((prev) => prev - 1);

    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;

    const move = history[historyIndex + 1];
    if (!move) return;

    const entry = cargoRegistryRef.current.find((e) => e.mesh.uuid === move.meshId);
    if (entry) syncEntryToPosition(entry, move.newPosition);

    setHistoryIndex((prev) => prev + 1);

    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  return { history, historyIndex, saveToHistory, undo, redo, clearHistory };
}