import { useCallback, useEffect, useState } from "react";
import { dmSocketUrl, listConversations, listDmMessages, listUsers, type Conversation, type Peer } from "../api/messaging";
import { useLiveChat } from "./useLiveChat";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [users, setUsers] = useState<Peer[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [convos, people] = await Promise.all([listConversations(), listUsers()]);
      setConversations(convos);
      setUsers(people);
    } catch {
      // liste vide par défaut, pas bloquant pour le reste de la page
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { conversations, users, refresh };
}

export function useDirectThread(peerId: string | null) {
  const loadHistory = useCallback(() => (peerId ? listDmMessages(peerId) : Promise.resolve([])), [peerId]);
  return useLiveChat(peerId, peerId ? dmSocketUrl(peerId) : null, loadHistory);
}
