import { generalChatSocketUrl, listGeneralMessages } from "../api/messaging";
import { useLiveChat } from "./useLiveChat";

export function useGeneralChat() {
  return useLiveChat("general", generalChatSocketUrl(), listGeneralMessages);
}
