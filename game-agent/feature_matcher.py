"""Match a user-selected textured patch. No enemy or gameplay semantics are implied."""
from __future__ import annotations
import cv2
import numpy as np


class FeatureMatcher:
    def __init__(self, template):
        self.orb = cv2.ORB_create(nfeatures=1400, edgeThreshold=8, fastThreshold=8)
        gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
        self.height, self.width = gray.shape
        self.points, self.descriptors = self.orb.detectAndCompute(gray, None)
        if self.descriptors is None or len(self.points) < 12:
            raise ValueError('目标选区缺乏纹理：请选择包含轮廓和细节的目标截图，不能只选纯色圆点。')
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)

    def match(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        points, descriptors = self.orb.detectAndCompute(gray, None)
        if descriptors is None or len(points) < 12:
            return None
        pairs = self.matcher.knnMatch(self.descriptors, descriptors, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < .72 * p[1].distance]
        # Repeated texture cannot satisfy the gate by reusing one scene keypoint.
        unique = {}
        for m in sorted(good, key=lambda m: m.distance):
            unique.setdefault(m.trainIdx, m)
        good = list(unique.values())
        if len(good) < 12:
            return None
        source = np.float32([self.points[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        destination = np.float32([points[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        matrix, mask = cv2.findHomography(source, destination, cv2.RANSAC, 3.0)
        if matrix is None or mask is None or not np.isfinite(matrix).all():
            return None
        inliers = mask.ravel().astype(bool)
        ratio = float(inliers.mean())
        if inliers.sum() < 12 or ratio < .6:
            return None
        coverage = cv2.contourArea(cv2.convexHull(source[inliers])) / (self.width * self.height)
        if coverage < .08:
            return None
        corners = np.float32([[0,0],[self.width,0],[self.width,self.height],[0,self.height]]).reshape(-1,1,2)
        polygon = cv2.perspectiveTransform(corners, matrix)
        if not np.isfinite(polygon).all() or not cv2.isContourConvex(polygon):
            return None
        area = cv2.contourArea(polygon)
        relative_area = area / (self.width * self.height)
        x,y,w,h = cv2.boundingRect(polygon)
        ih,iw = image.shape[:2]
        # Homography rounding can put an exactly edge-aligned corner one pixel outside.
        if not .2 <= relative_area <= 5 or x < -2 or y < -2 or x+w > iw+2 or y+h > ih+2:
            return None
        right,bottom=min(iw,x+w),min(ih,y+h)
        x,y=max(0,x),max(0,y)
        w,h=right-x,bottom-y
        return (x,y,w,h), ratio
