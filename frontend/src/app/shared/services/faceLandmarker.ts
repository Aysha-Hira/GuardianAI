import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'

let landmarker: FaceLandmarker | null = null
let loadPromise: Promise<FaceLandmarker | null> | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image for landmark detection'))
    img.src = src
  })
}

export async function getFaceLandmarker(): Promise<FaceLandmarker | null> {
  if (landmarker) return landmarker
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
      )
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        numFaces: 1,
      })
      return landmarker
    } catch {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        )
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          numFaces: 1,
        })
        return landmarker
      } catch {
        return null
      }
    }
  })()

  return loadPromise
}

export async function detectFaceLandmarks(imageUrl: string): Promise<NormalizedLandmark[] | null> {
  const detector = await getFaceLandmarker()
  if (!detector) return null

  const img = await loadImage(imageUrl)
  const result = detector.detect(img)
  return result.faceLandmarks?.[0] ?? null
}

/** MediaPipe indices used for face-region bounds */
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

/** Curated spy-style mesh connections (MediaPipe landmark indices) */
export const SPY_MESH_EDGES: [number, number][] = [
  [234, 93], [93, 132], [132, 58], [58, 172], [172, 136], [136, 150], [150, 149], [149, 176],
  [176, 148], [148, 152], [152, 377], [377, 400], [400, 378], [378, 379], [379, 365], [365, 397],
  [397, 288], [288, 361], [361, 323], [323, 454],
  [70, 63], [63, 105], [105, 66], [66, 107],
  [336, 296], [296, 334], [334, 293], [293, 300],
  [33, 133], [133, 160], [160, 159], [159, 158], [158, 157], [157, 173], [173, 144], [144, 33],
  [362, 263], [263, 387], [387, 386], [386, 385], [385, 384], [384, 398], [398, 373], [373, 362],
  [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1], [1, 2], [2, 164], [164, 168],
  [61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321],
  [321, 375], [375, 291], [291, 61],
  [107, 33], [300, 362], [66, 168], [293, 168], [152, 1], [10, 168], [234, 70], [323, 300],
]

export const NOSE_TIP_INDEX = 1
