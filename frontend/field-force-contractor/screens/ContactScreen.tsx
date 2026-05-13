import { RootStackParamList } from "@/App"
import { ContactCard } from "@/components/ContactCard"
import { MainFrame } from "@/components/MainFrame"
import { SearchBar } from "@/components/SearchBar"
import { SHOWCASE_MODE } from "@/constants/showcase"
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
    // Start empty (not with demoUsers) so the screen never flashes demo
    // contacts before the real backend list arrives. Jonathan caught this
    // during testing — the previous `useState<...>(null)` fell back to
    // demoUsers on first render which is visible as a brief glitch.
    const [remoteContacts, setRemoteContacts] = useState<userTable[]>([])
    const [loadFailed, setLoadFailed] = useState(false)
    const [nameSearch, setNameSearch] = useState("")
    const route = useRoute<RouteProp<RootStackParamList,'Contacts'>>()
    const sort = route.params?.sort

    // Pull the real contact list from the backend. Only fall back to
    // demoUsers when (a) the fetch genuinely failed AND (b) we're in
    // SHOWCASE_MODE, so demo builds stay functional offline while
    // production never shows fake demo data.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await api.authGet<{contacts: BackendContact[]}>('/contractors/contacts')
                if (cancelled) return
                const rows = (res?.contacts ?? []).map(toUserRow)
                setRemoteContacts(rows)
                setLoadFailed(false)
            } catch {
                if (!cancelled) setLoadFailed(true)
            }
        })()
        return () => { cancelled = true }
    }, [])

    // Real backend list wins. If the fetch failed AND we're in showcase
    // mode, fall back to demoUsers so the demo doesn't break offline.
    // Production with a backend failure shows an empty list rather than
    // fake data.
    const base: userTable[] =
        remoteContacts.length > 0
            ? remoteContacts
            : (loadFailed && SHOWCASE_MODE)
                ? demoUsers
                : []
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
