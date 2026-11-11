# Identify one physical Fast & Furious car

**Do not arm from a chooser name or a scan count.** During the November 11 trial, the operator selected an intended, physically labeled International MXT and the browser established a real GATT connection. The operator reported its top light changing from green to pulsing blue on connection, but repeated custom off → green → off commands produced **no observed light change**. The custom light check therefore did not establish physical identity. Battery notifications were received; no motor command was sent. Exact private identifiers are omitted. [Actual LIVE evidence and limitations](VALIDATION.md#hardware-check-and-stopping-point).

The instructor page now accepts either a visibly observed custom light pattern or a deliberate power-button check with exact same-device reconnect and operator attestation. The power-button path is a new software workflow; its physical acceptance remains pending. Neither method provides cryptographic device authentication.

## Use the underside button correctly

The grey button underneath the car is the on/off button. **Press and release it once** to change between on and off. A press that turns the car off is expected behavior. Placing the car on the charging platform also turns it on, so removing the other cars from a powered platform matters when isolating one car.

Do not use a hold/reset procedure or rapid repeated presses. **Five rapid presses activate Drone Mode**, which can make a car drive by itself when placed on track. That is outside this identification procedure. The official support article describes the button's normal on/off action and does not provide a reset procedure. [Official ANKI power-button guidance](https://support.anki.bot/article/341-tire-replacement).

Keep wheels raised clear and fingers, hair and cables away. If the physical on/off state is unclear, pause and observe; do not try sequences of button presses to make the browser list change.

## Give every car its own physical label

Each student's two cars need different labels, such as `S01-A` and `S01-B`, with the model recorded alongside each label. Another student's International MXT can advertise the same name. Label all four instructor cars distinctly too. A printed model name, identical encoded Bluetooth name, list position, strongest signal/RSSI or number of chooser entries cannot establish which toy is selected.

The page's `BluetoothDevice.id` is an opaque browser permission identifier, scoped to its browser/profile and web origin. It is **not a MAC address or printed serial number**. Even if a native chooser happens to display a Bluetooth address, ordinary page JavaScript has no MAC-address field or direct-connect-by-MAC option here. Keep addresses from a separate trusted source in private inventory as operator notes, not as automatically verified mappings. [Web Bluetooth device model](https://bluetooth.spec.whatwg.org/#bluetoothdevice).

For existing stationary enrollment and remembering your pair, keep following [the fleet workflow](../bench/FLEET.md) and [the identification trial](../bench/IDENTIFY.md). Those workflows remain available and unchanged. A saved mapping at a Codespace address does not transfer automatically to this instructor tool's localhost origin; the driving tool requires fresh physical confirmation.

## Instructor driving requires isolation before selection

1. Coordinate one kit at a time in a quiet enrollment area. Remove other nearby course cars from powered charging platforms and switch them off. Close competing apps and bench tabs. Keep only the labeled MXT powered on, off its charger, in sight with wheels clear.
2. Cancel the old browser chooser, then deliberately open a fresh chooser. Use the Anki-service filter first. The explicit all-devices fallback is only for an isolated car missing from that filter. If several candidates remain ambiguous, cancel and improve isolation; do not guess.
3. Enter the unique physical label and acknowledge the setup in **Connect one car**, then select the candidate. The page binds that label to the selected browser identity for this session. Follow one of the checks below before confirming. The browser ID is available under **Debug, evidence & instructions**; typing it again is not required.
4. Only after personally observing the selected check on that exact labeled car, tick the observation box and choose **Confirm this car**. If the result is absent, on another car or unclear, do not attest and do not arm. A completed check permits the remaining qualification steps; it is not acceptance of driving behavior.

A chooser row need not vanish immediately when its car turns off. Reopening discovery can help separate observations, but neither disappearing/reappearing rows nor a changed scan count is proof. Current Chromium chooser code adds or updates discovered entries; it is not a physical-power-state indicator. [Chromium chooser implementation](https://github.com/chromium/chromium/blob/main/content/browser/bluetooth/bluetooth_device_chooser_controller.cc#L377-L403).

## Power-button check

1. With the selected car connected and wheels clear, choose **Check using power button**. This starts a **30-second** window; the check itself sends no car command.
2. Press and release the labeled car's underside button **once** to turn it off. Do not click the page's Disconnect button. Wait for the page to report the expected Bluetooth disconnection. A random radio dropout alone does not identify a car; the operator must have caused and observed this physical power-off.
3. Press and release the same car's button once to turn it on. Choose **Reconnect same car**, then explicitly select that device in the browser chooser. The page compares the selected browser ID with the immutable original ID **before opening GATT** and rejects a mismatch. It never reconnects or resumes automatically.
4. After the same-device reconnect succeeds, attest that you personally switched the exact labeled car off and on and observed the corresponding connection changes. Choose **Confirm this car** only if the whole sequence was clear.

Timeout, cancellation, a wrong device, page reload or an ordinary/emergency disconnect invalidates the attempt; start a fresh selection and identification. This check combines deliberate physical action, a real connection-loss event, exact browser-ID continuity and human observation. It does not establish a printed serial number, ownership, firmware compatibility, battery health or motion safety.

## Optional light check

Choose **Try light signal · optional** and watch the labeled car for the bounded **off → green → off** engine-light pattern. Verify no other car reacts. The inherited bench routine enables its identification SDK mode, sends the pattern, then requests engine-off and SDK-off; it does not restore the car's previous light/SDK state.

Only a clear physical observation qualifies. A blue connection light, a battery reply or completed write messages do not prove that the custom pattern appeared. If the pattern is absent, leave its observation box unchecked and use the power-button path instead. Do not increase LED intensity, change firmware or send a motion command to identify the car. The original stationary bench codec and evidence workflow remain unchanged.

## Busy-classroom fallback stays stationary

If strict isolation is not available, use the **existing stationary bench's dedicated candidate-identification workflow**, with nearby owners aware that one candidate may receive a bounded light trial. Keep wheels clear; choose one candidate deliberately; signal only that candidate; observe the exact physical car; record the result and disconnect. Do not automate trials through the room or blink multiple cars. If the result remains ambiguous, do not confirm, remember or drive that candidate. Arrange a quieter enrollment window; replay remains available.

The bench's optional guided physical on/off and near/far trial supplies supporting observations only. It cannot measure distance, prove ownership or guarantee identity. Advertisement watching may be unavailable, and silence may result from the browser, radio or visibility rather than a powered-off car. **No experimental browser flags are needed for this procedure; do not change them to force a result.** Proceed to the separate stationary light trial only under its documented precautions, or use isolated enrollment. [Primary browser implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md#chrome) · [Advertisement watching specification](https://bluetooth.spec.whatwg.org/#dom-bluetoothdevice-watchadvertisements).

Preserve LIVE observations separately from SIMULATION/replay evidence. Identification permits proceeding to the remaining [instructor qualification steps](README.md#one-car-live-sequence); it does not establish firmware compatibility, battery health, safe motion or successful STOP.
