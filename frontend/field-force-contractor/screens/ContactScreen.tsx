import { RootStackParamList } from "@/App"
import { ContactCard } from "@/components/ContactCard"
import { MainFrame } from "@/components/MainFrame"
import { SearchBar } from "@/components/SearchBar"
import { AppContext, demoUsers, userTable } from "@/contexts/AppContext"
import { api } from "@/utils/api"
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FC, useContext, useEffect, useState } from "react"

// Shape returned by GET /contractors/contacts. snake_case keys map onto our
// camelCase userTable below.
type BackendContact = {
    id:         string
    first_name: string
    last_name:  string
    phone:      string
    email?:     string
    role?:      string
    source?:    string
}

const toUserRow = (c: BackendContact): userTable => ({
    userid:    c.id,
    firstName: c.first_name || '',
    lastName:  c.last_name  || '',
    phone:     c.phone      || '',
    role:      c.role       || '',
    vendorid:  '',
})

export const Contacts:FC = (props) => {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
    const {client} = useContext(AppContext)
    const [remoteContacts, setRemoteContacts] = useState<userTable[] | null>(null)
    const [nameSearch, setNameSearch] = useState("")
    const route = useRoute<RouteProp<RootStackParamList,'Contacts'>>()
    const sort = route.params?.sort

    // Pull the real contact list from the backend. Falls back to demoUsers
    // if the request fails so the screen is still usable offline / when the
    // backend is unreachable.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await api.authGet<{contacts: BackendContact[]}>('/contractors/contacts')
                if (cancelled) return
                const rows = (res?.contacts ?? []).map(toUserRow)
                setRemoteContacts(rows)
            } catch {
                if (!cancelled) setRemoteContacts(null)
            }
        })()
        return () => { cancelled = true }
    }, [])

    // Prefer the real backend list when we have it. Append the current
    // client object so the sort=true filter still works the way it did on
    // the demo data.
    const base: userTable[] = remoteContacts ?? demoUsers
    const contacts: userTable[] = (client) ? [...base, client] : base

    const Search:FC = () => (
        <SearchBar onClick={(msg:string)=>{setNameSearch(msg)}}/>
    )

    return(<>
    <MainFrame header="home" headerMenu={["Menu2",["Contacts"]]} injectHeader={<Search/>}>
      {
        contacts.filter(ct => (`${ct.firstName.toUpperCase()} ${ct.lastName.toUpperCase()}`).includes((sort && client) ? `${client.firstName} ${client.lastName}`.toUpperCase() : nameSearch.toUpperCase())).map((item) =>{
          return( <ContactCard key={item.userid} contactId={item.userid} phoneNumber={item.phone} name={`${item.firstName} ${ item.lastName}`}/>)
        })
      }
    </MainFrame>
    </>)
}
