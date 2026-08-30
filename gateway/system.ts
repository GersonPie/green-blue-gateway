import { log } from '../functions.ts'
import { _STARTING_PORT, _MAX_CONTAINERS, _BASE_URL } from './server.ts'





const check_running_apps = async () => {

    let running_apps: number[] = [];
    for (let i: number = 0; i <= _MAX_CONTAINERS; i++) {

        const port = _STARTING_PORT + i;
        log(`[system] port scanner heating up!...`)
        log(`[system] - checking port ${port}`)

        try {
            const response = await fetch(`${_BASE_URL}${port}/name`)
            if (response.ok) {
                const data = response.json()
                running_apps.push({ port, data })
            }
        }
        catch (err) {
            log.error
        }

    }

    return running_apps
}




export { check_running_apps }