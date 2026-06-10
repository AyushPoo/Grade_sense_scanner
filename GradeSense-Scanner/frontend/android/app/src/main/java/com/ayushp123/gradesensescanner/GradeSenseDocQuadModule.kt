package com.ayushp123.gradesensescanner

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class GradeSenseDocQuadModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "GradeSenseDocQuad"

  @ReactMethod
  fun detect(imageUri: String, promise: Promise) {
    executor.execute {
      try {
        val bitmap = decodeBitmap(imageUri)
            ?: throw IllegalArgumentException("Unable to decode image URI")
        val detector = DetectorHolder.get(reactContext)
        val result = detector.detect(bitmap)
        bitmap.recycle()

        val map = Arguments.createMap()
        map.putBoolean("detected", result != null)
        if (result != null) {
          map.putDouble("confidence", result.confidence)
          map.putString("source", "docquad")
          map.putInt("width", result.width)
          map.putInt("height", result.height)
          map.putMap("quadrilateral", pointsToMap(result.points))
        }
        promise.resolve(map)
      } catch (t: Throwable) {
        promise.reject("DOCQUAD_DETECT_FAILED", t.message, t)
      }
    }
  }

  private fun decodeBitmap(imageUri: String): Bitmap? {
    val uri = Uri.parse(imageUri)
    val options = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return reactContext.contentResolver.openInputStream(uri)?.use { input ->
      BitmapFactory.decodeStream(input, null, options)
    }
  }

  private fun pointsToMap(points: Array<Point>): com.facebook.react.bridge.WritableMap {
    val map = Arguments.createMap()
    map.putMap("topLeft", pointToMap(points[0]))
    map.putMap("topRight", pointToMap(points[1]))
    map.putMap("bottomRight", pointToMap(points[2]))
    map.putMap("bottomLeft", pointToMap(points[3]))
    return map
  }

  private fun pointToMap(point: Point): com.facebook.react.bridge.WritableMap {
    val map = Arguments.createMap()
    map.putDouble("x", point.x)
    map.putDouble("y", point.y)
    return map
  }

  private data class Point(val x: Double, val y: Double)

  private data class Detection(
      val points: Array<Point>,
      val width: Int,
      val height: Int,
      val confidence: Double
  )

  private object DetectorHolder {
    private const val MODEL_ASSET = "docquad/docquadnet256_trained_opset17.ort"
    private var detector: DocQuadDetector? = null

    @Synchronized
    fun get(context: Context): DocQuadDetector {
      val existing = detector
      if (existing != null) return existing
      val created = DocQuadDetector(context.applicationContext, MODEL_ASSET)
      detector = created
      return created
    }
  }

  private class DocQuadDetector(
      private val context: Context,
      private val modelAsset: String
  ) {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession

    init {
      val modelFile = copyAssetToCache(context, modelAsset)
      val options = OrtSession.SessionOptions().apply {
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        setIntraOpNumThreads(max(1, Runtime.getRuntime().availableProcessors() / 2))
        try {
          addXnnpack(emptyMap())
        } catch (_: Throwable) {
        }
      }
      session = env.createSession(modelFile.absolutePath, options)
      options.close()
    }

    fun detect(bitmap: Bitmap): Detection? {
      val width = bitmap.width
      val height = bitmap.height
      if (width <= 0 || height <= 0) return null

      val letterbox = Letterbox.create(width, height, 256, 256)
      val inputBitmap = renderLetterbox256(bitmap, letterbox)
      val input = bitmapToNchwFloat01(inputBitmap)
      inputBitmap.recycle()

      val tensor = OnnxTensor.createTensor(
          env,
          FloatBuffer.wrap(input),
          longArrayOf(1, 3, 256, 256)
      )
      tensor.use { inputTensor ->
        session.run(mapOf("input" to inputTensor)).use { output ->
          @Suppress("UNCHECKED_CAST")
          val heatmaps = output.get("corner_heatmaps").get().value
              as Array<Array<Array<FloatArray>>>
          val peakData = cornersFromHeatmaps(heatmaps, letterbox)
          val points = peakData.points
          if (!isValidQuad(points, width, height)) return null
          val confidence = estimateConfidence(points, width, height, peakData.minPeakSigma)
          return Detection(points, width, height, confidence)
        }
      }
    }

    private fun copyAssetToCache(context: Context, assetPath: String): File {
      val safeName = assetPath.replace("/", "_")
      val outFile = File(context.cacheDir, safeName)
      if (outFile.exists() && outFile.length() > 0) return outFile
      context.assets.open(assetPath).use { input ->
        FileOutputStream(outFile).use { output ->
          input.copyTo(output)
        }
      }
      return outFile
    }

    private fun renderLetterbox256(src: Bitmap, letterbox: Letterbox): Bitmap {
      val out = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(out)
      canvas.drawColor(Color.rgb(128, 128, 128))
      val dst = RectF(
          letterbox.offsetX.toFloat(),
          letterbox.offsetY.toFloat(),
          (letterbox.offsetX + src.width * letterbox.scale).toFloat(),
          (letterbox.offsetY + src.height * letterbox.scale).toFloat()
      )
      val paint = Paint().apply {
        isFilterBitmap = true
        isDither = true
        isAntiAlias = true
      }
      canvas.drawBitmap(src, null, dst, paint)
      return out
    }

    private fun bitmapToNchwFloat01(bitmap: Bitmap): FloatArray {
      val width = bitmap.width
      val height = bitmap.height
      val hw = width * height
      val pixels = IntArray(hw)
      bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
      val out = FloatArray(3 * hw)
      for (y in 0 until height) {
        for (x in 0 until width) {
          val color = pixels[y * width + x]
          val idx = y * width + x
          out[idx] = Color.red(color) / 255.0f
          out[hw + idx] = Color.green(color) / 255.0f
          out[2 * hw + idx] = Color.blue(color) / 255.0f
        }
      }
      return out
    }

    private data class CornerPeaks(
        val points: Array<Point>,
        val minPeakSigma: Double
    )

    private fun cornersFromHeatmaps(
        heatmaps: Array<Array<Array<FloatArray>>>,
        letterbox: Letterbox
    ): CornerPeaks {
      val points = Array(4) { Point(0.0, 0.0) }
      var minPeakSigma = Double.POSITIVE_INFINITY
      for (channel in 0 until 4) {
        val heatmap = heatmaps[0][channel]
        val peak = refinePeak(heatmap)
        minPeakSigma = min(minPeakSigma, peak.peakSigma)
        val x256 = (peak.x64 + 0.5) * 4.0
        val y256 = (peak.y64 + 0.5) * 4.0
        val x = (x256 - letterbox.offsetX) / letterbox.scale
        val y = (y256 - letterbox.offsetY) / letterbox.scale
        points[channel] = Point(x, y)
      }
      return CornerPeaks(points, minPeakSigma)
    }

    private data class Peak(
        val x64: Double,
        val y64: Double,
        val peakSigma: Double
    )

    private fun refinePeak(heatmap: Array<FloatArray>): Peak {
      var bestX = 0
      var bestY = 0
      var best = -Float.MAX_VALUE
      var sum = 0.0
      var count = 0
      for (y in 0 until 64) {
        for (x in 0 until 64) {
          val value = heatmap[y][x]
          sum += value.toDouble()
          count += 1
          if (value > best) {
            best = value
            bestX = x
            bestY = y
          }
        }
      }

      val mean = sum / max(1, count)
      var sumSq = 0.0
      for (y in 0 until 64) {
        for (x in 0 until 64) {
          val delta = heatmap[y][x].toDouble() - mean
          sumSq += delta * delta
        }
      }
      val std = sqrt(sumSq / max(1, count))
      val peakSigma = if (std > 1e-6) (best.toDouble() - mean) / std else 0.0

      val x0 = max(0, bestX - 2)
      val x1 = min(63, bestX + 2)
      val y0 = max(0, bestY - 2)
      val y1 = min(63, bestY + 2)
      var weightedX = 0.0
      var weightedY = 0.0
      var weightedSum = 0.0
      for (y in y0..y1) {
        for (x in x0..x1) {
          val weight = kotlin.math.exp((heatmap[y][x] - best).toDouble())
          weightedX += x * weight
          weightedY += y * weight
          weightedSum += weight
        }
      }
      if (weightedSum <= 1e-9) {
        return Peak(bestX.toDouble(), bestY.toDouble(), peakSigma)
      }
      return Peak(weightedX / weightedSum, weightedY / weightedSum, peakSigma)
    }

    private fun estimateConfidence(points: Array<Point>, width: Int, height: Int, minPeakSigma: Double): Double {
      val areaRatio = polygonArea(points) / max(1.0, width.toDouble() * height.toDouble())
      val bbox = bbox(points)
      val bboxArea = max(1.0, (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY))
      val rectangularity = polygonArea(points) / bboxArea
      val areaConfidence = ((areaRatio - 0.12) / 0.45).coerceIn(0.0, 1.0)
      val shapeConfidence = rectangularity.coerceIn(0.0, 1.0)
      val peakConfidence = (minPeakSigma / 3.2).coerceIn(0.0, 1.0)
      return (0.35 * areaConfidence + 0.35 * shapeConfidence + 0.30 * peakConfidence)
          .coerceIn(0.0, 0.98)
    }

    private fun isValidQuad(points: Array<Point>, width: Int, height: Int): Boolean {
      if (points.size != 4) return false
      for (point in points) {
        if (!point.x.isFinite() || !point.y.isFinite()) return false
        if (point.x < -width * 0.18 || point.x > width * 1.18) return false
        if (point.y < -height * 0.18 || point.y > height * 1.18) return false
      }
      if (!isConvex(points)) return false
      val areaRatio = polygonArea(points) / max(1.0, width.toDouble() * height.toDouble())
      return areaRatio >= 0.08 && areaRatio <= 1.18
    }

    private fun isConvex(points: Array<Point>): Boolean {
      var positive = 0
      var negative = 0
      for (i in points.indices) {
        val a = points[i]
        val b = points[(i + 1) % points.size]
        val c = points[(i + 2) % points.size]
        val cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
        if (cross > 0) positive += 1
        if (cross < 0) negative += 1
      }
      return positive == points.size || negative == points.size
    }

    private fun polygonArea(points: Array<Point>): Double {
      var area = 0.0
      for (i in points.indices) {
        val next = points[(i + 1) % points.size]
        area += points[i].x * next.y - next.x * points[i].y
      }
      return kotlin.math.abs(area) / 2.0
    }

    private data class Bounds(val minX: Double, val maxX: Double, val minY: Double, val maxY: Double)

    private fun bbox(points: Array<Point>): Bounds {
      return Bounds(
          points.minOf { it.x },
          points.maxOf { it.x },
          points.minOf { it.y },
          points.maxOf { it.y }
      )
    }
  }

  private data class Letterbox(
      val scale: Double,
      val offsetX: Double,
      val offsetY: Double
  ) {
    companion object {
      fun create(srcW: Int, srcH: Int, dstW: Int, dstH: Int): Letterbox {
        val scale = min(dstW.toDouble() / srcW.toDouble(), dstH.toDouble() / srcH.toDouble())
        val newW = srcW * scale
        val newH = srcH * scale
        return Letterbox(scale, (dstW - newW) / 2.0, (dstH - newH) / 2.0)
      }
    }
  }
}
