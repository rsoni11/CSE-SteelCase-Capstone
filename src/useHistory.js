import { useState, useRef, useEffect } from 'react';

// Custom hook for undo/redo move history
export function useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef) {
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveToHistory = (mesh, oldPos, newPos) => {
    const move = {
      meshId: mesh.uuid,
      oldPosition: oldPos.clone(),
      newPosition: newPos.clone()
    };
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(move);
      return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  };

  const undo = () => {
    if (historyIndex < 0 || historyIndex >= history.length) return;
    const move = history[historyIndex];
    if (!move) return;
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) entry.mesh.position.copy(move.oldPosition);
    setHistoryIndex(prev => prev - 1);
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const move = history[historyIndex + 1];
    if (!move) return;
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) entry.mesh.position.copy(move.newPosition);
    setHistoryIndex(prev => prev + 1);
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
  };

  // Keyboard shortcuts Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  return { history, historyIndex, saveToHistory, undo, redo, clearHistory };
}
