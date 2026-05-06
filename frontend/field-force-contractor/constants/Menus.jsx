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
    {label:"AI",icon:Assets.icons.AiIcon,component:"InspectionAssist"},
    


 ],
};
   
