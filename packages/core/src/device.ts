import * as EventEmitter from 'eventemitter3'
import { WheelEvent } from '.'

import { HIDDevice } from './hid'
import {
	KeyIndex,
	XencelabsQuickKeys,
	XencelabsQuickKeysDisplayBrightness,
	XencelabsQuickKeysEvents,
	XencelabsQuickKeysDisplayOrientation,
	XencelabsQuickKeysWheelSpeed,
} from './types'

const keyCount = 10
const textKeyCount = 8

export class XencelabsQuickKeysDevice extends EventEmitter<XencelabsQuickKeysEvents> implements XencelabsQuickKeys {
	protected readonly device: HIDDevice
	private readonly keyState: boolean[]

	public static async create(device: HIDDevice): Promise<XencelabsQuickKeysDevice> {
		const wrappedDevice = new XencelabsQuickKeysDevice(device)

		// Now setup the hid events
		wrappedDevice.subscribeToHIDEvents()

		// Ask the device to stream presses
		await wrappedDevice.subscribeToEventStreams()

		return wrappedDevice
	}

	private constructor(device: HIDDevice) {
		super()

		this.device = device

		this.keyState = new Array(keyCount).fill(false)
	}

	private subscribeToHIDEvents(): void {
		this.device.on('data', (reportId, data) => {
			if (reportId === 0x02) {
				if (data.readUInt8(0) === 0xf0) {
					const wheelByte = data.readUInt8(6)
					if (wheelByte > 0) {
						if (wheelByte & 0x01) {
							this.emit('wheel', WheelEvent.Right)
						} else if (wheelByte & 0x02) {
							this.emit('wheel', WheelEvent.Left)
						}
					} else {
						const keys = data.readUInt16LE(1)
						for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
							const keyPressed = (keys & (1 << keyIndex)) > 0
							const stateChanged = keyPressed !== this.keyState[keyIndex]
							if (stateChanged) {
								this.keyState[keyIndex] = keyPressed
								if (keyPressed) {
									this.emit('down', keyIndex)
								} else {
									this.emit('up', keyIndex)
								}
							}
						}
					}
				} else if (data.readUInt8(0) === 0xf8) {
					const newState = data.readUInt8(1)
					// 3 - means 'already connected'
					if (newState === 4) {
						this.emit('disconnected')
					} else if (newState === 2) {
						// Resubscribe to events
						this.subscribeToEventStreams().catch((e) => {
							this.emit('error', e)
						})

						this.emit('connected')
					}
				} else if (data.readUInt8(0) === 0xf2 && data.readUInt8(1) === 0x01) {
					const percent = data.readUInt8(2)
					this.emit('battery', percent)
				}
			}
		})

		this.device.on('error', (err) => {
			this.emit('error', err)
		})
	}

	private async subscribeToEventStreams(): Promise<void> {
		// Key events
		const keyBuffer = Buffer.alloc(32)
		keyBuffer.writeUInt8(0x02, 0)
		keyBuffer.writeUInt8(0xb0, 1)
		keyBuffer.writeUInt8(0x04, 2)
		this.insertHeader(keyBuffer)

		// // this appears to check if there is a surface already connected to the dongle
		// const buffer2 = Buffer.alloc(32)
		// buffer2.writeUInt8(0x02, 0)
		// buffer2.writeUInt8(0xb8, 1)
		// buffer2.writeUInt8(0x01, 2)
		// this.insertHeader(buffer2)

		// battery level
		const batteryBuffer = Buffer.alloc(32)
		batteryBuffer.writeUInt8(0x02, 0)
		batteryBuffer.writeUInt8(0xb4, 1)
		batteryBuffer.writeUInt8(0x10, 2)
		this.insertHeader(batteryBuffer)

		return this.device.sendReports([keyBuffer, batteryBuffer])
	}

	public checkValidKeyIndex(keyIndex: KeyIndex): void {
		if (keyIndex < 0 || keyIndex >= keyCount) {
			throw new TypeError(`Expected a valid keyIndex 0 - ${keyCount - 1}`)
		}
	}

	public async close(): Promise<void> {
		return this.device.close()
	}

	private insertHeader(buffer: Buffer): void {
		buffer.writeUInt8(0xeb, 10)
		buffer.writeUInt8(0x4f, 11)
		buffer.writeUInt8(0x49, 12)
		buffer.writeUInt8(0xbd, 13)
		buffer.writeUInt8(0xd7, 14)
		buffer.writeUInt8(0xfa, 15)
	}

	public async setKeyText(keyIndex: KeyIndex, text: string): Promise<void> {
		if (keyIndex < 0 || keyIndex >= textKeyCount) {
			throw new TypeError(`Expected a valid keyIndex 0 - ${textKeyCount - 1}`)
		}

		if (typeof text !== 'string' || text.length > 8)
			throw new TypeError(`Expected a valid label of up to 8 characters`)

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb1, 1)
		buffer.writeUInt8(keyIndex + 1, 3)
		buffer.writeUInt8(text.length * 2, 5)

		this.insertHeader(buffer)

		buffer.write(text, 16, 'utf16le')

		return this.device.sendReports([buffer])
	}

	public async setWheelColor(r: number, g: number, b: number): Promise<void> {
		this.checkRGBValue(r)
		this.checkRGBValue(g)
		this.checkRGBValue(b)

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb4, 1)
		buffer.writeUInt8(0x01, 2)
		buffer.writeUInt8(0x01, 3)

		buffer.writeUInt8(r, 6)
		buffer.writeUInt8(g, 7)
		buffer.writeUInt8(b, 8)

		this.insertHeader(buffer)

		return this.device.sendReports([buffer])
	}

	private checkRGBValue(value: number): void {
		if (value < 0 || value > 255) {
			throw new TypeError('Expected a valid color RGB value 0 - 255')
		}
	}

	public async setDisplayOrientation(orientation: XencelabsQuickKeysDisplayOrientation): Promise<void> {
		if (!Object.values(XencelabsQuickKeysDisplayOrientation).includes(orientation)) {
			throw new TypeError('Expected a valid orientation')
		}

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb1, 1)
		buffer.writeUInt8(orientation, 2)

		this.insertHeader(buffer)

		return this.device.sendReports([buffer])
	}

	public async setDisplayBrightness(brightness: XencelabsQuickKeysDisplayBrightness): Promise<void> {
		if (!Object.values(XencelabsQuickKeysDisplayBrightness).includes(brightness)) {
			throw new TypeError('Expected a valid brightness')
		}

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb1, 1)
		buffer.writeUInt8(0x0a, 2)
		buffer.writeUInt8(0x01, 3)
		buffer.writeUInt8(brightness, 4)

		this.insertHeader(buffer)

		return this.device.sendReports([buffer])
	}

	public async setWheelSpeed(speed: XencelabsQuickKeysWheelSpeed): Promise<void> {
		if (!Object.values(XencelabsQuickKeysWheelSpeed).includes(speed)) {
			throw new TypeError('Expected a valid speed')
		}

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb4, 1)
		buffer.writeUInt8(0x04, 2)
		buffer.writeUInt8(0x01, 3)
		buffer.writeUInt8(0x01, 4)
		buffer.writeUInt8(speed, 5)

		this.insertHeader(buffer)

		return this.device.sendReports([buffer])
	}

	public async setSleepTimeout(minutes: number): Promise<void> {
		if (minutes < 0 || minutes > 255) {
			throw new TypeError('Expected a valid number of minutes')
		}

		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb4, 1)
		buffer.writeUInt8(0x08, 2)
		buffer.writeUInt8(0x01, 3)
		buffer.writeUInt8(minutes, 4)

		this.insertHeader(buffer)

		return this.device.sendReports([buffer])
	}

	public async showOverlayText(duration: number, text: string): Promise<void> {
		if (duration <= 0 || duration > 255) throw new TypeError('Expected a valid number of seconds')

		if (typeof text !== 'string' || text.length > 32)
			throw new TypeError(`Expected a valid overlay text of up to 32 characters`)

		const buffers = [
			this.createOverlayChunk(0x05, duration, text.substr(0, 8), false),
			this.createOverlayChunk(0x06, duration, text.substr(8, 8), text.length > 16),
		]

		for (let offset = 16; offset < text.length; offset += 8) {
			buffers.push(this.createOverlayChunk(0x06, duration, text.substr(offset, 8), text.length > offset + 8))
		}

		return this.device.sendReports(buffers)
	}

	private createOverlayChunk(specialByte: number, duration: number, chars: string, hasMore: boolean): Buffer {
		const buffer = Buffer.alloc(32)
		buffer.writeUInt8(0x02, 0)
		buffer.writeUInt8(0xb1, 1)
		buffer.writeUInt8(specialByte, 2)
		buffer.writeUInt8(duration, 3)
		buffer.writeUInt8(chars.length * 2, 5)
		buffer.writeUInt8(hasMore ? 0x01 : 0x00, 6)

		this.insertHeader(buffer)

		buffer.write(chars, 16, 'utf16le')

		return buffer
	}
}
