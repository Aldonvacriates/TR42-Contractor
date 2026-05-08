import { Assets } from "../constants/Assets";

export const Menus = {


  // ── Footer ────────────────────────────────────────────────
  // Footer is used in MainFrame as the default footer menu when Menu variant "Menu3" is rendered.
  // label is used in MenuItem as the visible text for each footer navigation option.
  // icon is used in MenuItem as the image shown above each footer label.
  // component is used in MenuItem as the target screen name passed to navigation.navigate().

  Footer:[

    {label:"Dashboard",icon:Assets.icons.HomeIcon,component:"Home"},
    {label:"Tickets",icon:Assets.icons.TaskIcon,component:"Tickets"},
    {label:"Contacts",icon:Assets.icons.ContactIcon,component:"Contacts"},
    // The AI tab opens the conversational assistant (ChatAssistantScreen),
    // which is where the OSHA-citation templates and Q&A flow live.
    // InspectionAssistScreen is reachable from the inspection flow itself
    // (ticket -> Inspection -> AI assist) where the one-shot report
    // generator makes sense; routing the bottom tab there hid the chat.
    {label:"AI",icon:Assets.icons.AiIcon,component:"ChatAssistant"},
    


 ],
};
   
